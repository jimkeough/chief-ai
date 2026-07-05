// Start the Gmail connection: redirect the signed-in user to their OWN Google
// OAuth consent screen (their client ID, their cloud project). A random state
// nonce goes into a short-lived httpOnly cookie; the callback verifies it.

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getAuthed } from "@/lib/auth";
import { buildAuthUrl, googleOauthConfigured } from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await getAuthed())) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (!googleOauthConfigured()) {
    return new Response(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Add them to your deployment's environment variables first.",
      { status: 500 },
    );
  }
  const state = randomBytes(16).toString("hex");
  const origin = new URL(req.url).origin;
  const res = NextResponse.redirect(buildAuthUrl(origin, state));
  res.cookies.set("google_oauth_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https"),
    sameSite: "lax",
    maxAge: 600,
    path: "/api/google",
  });
  return res;
}
