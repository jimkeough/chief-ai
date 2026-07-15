import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthed } from "@/lib/auth";
import {
  buildFrontAuthorization,
  publicFrontOAuthError,
} from "@/lib/front-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_OPTIONS = (secure: boolean) =>
  ({
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/front",
  }) as const;

export async function GET(req: NextRequest) {
  const authed = await getAuthed();
  if (!authed) return NextResponse.redirect(new URL("/login", req.url));

  const origin = new URL(req.url).origin;
  const state = randomBytes(24).toString("base64url");
  try {
    const { authorizationUrl, codeVerifier } = await buildFrontAuthorization(
      authed.userId,
      origin,
      state,
    );
    const response = NextResponse.redirect(authorizationUrl);
    const options = COOKIE_OPTIONS(origin.startsWith("https://"));
    response.cookies.set("front_oauth_state", state, options);
    response.cookies.set("front_oauth_verifier", codeVerifier, options);
    return response;
  } catch (error) {
    const message = publicFrontOAuthError(error);
    return NextResponse.redirect(
      new URL(`/config/connections?front_error=${encodeURIComponent(message)}`, req.url),
    );
  }
}
