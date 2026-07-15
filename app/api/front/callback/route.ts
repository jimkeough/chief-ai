import { NextResponse, type NextRequest } from "next/server";
import { getAuthed } from "@/lib/auth";
import {
  exchangeFrontCodeAndStore,
  publicFrontOAuthError,
} from "@/lib/front-auth";
import { invalidateMcpToolCache } from "@/lib/mcp-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearOAuthCookies(response: NextResponse): NextResponse {
  response.cookies.delete("front_oauth_state");
  response.cookies.delete("front_oauth_verifier");
  return response;
}

export async function GET(req: NextRequest) {
  const authed = await getAuthed();
  if (!authed) return NextResponse.redirect(new URL("/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("front_oauth_state")?.value;
  const codeVerifier = req.cookies.get("front_oauth_verifier")?.value;
  const fail = (message: string) =>
    clearOAuthCookies(
      NextResponse.redirect(
        new URL(
          `/config/connections?front_error=${encodeURIComponent(message)}`,
          req.url,
        ),
      ),
    );

  if (url.searchParams.get("error")) {
    return fail(`Front returned: ${url.searchParams.get("error")}`);
  }
  if (!code) return fail("Front did not return an authorization code.");
  if (!state || !cookieState || state !== cookieState || !codeVerifier) {
    return fail("The Front connection attempt expired. Start it again.");
  }

  try {
    await exchangeFrontCodeAndStore(authed.userId, url.origin, code, codeVerifier);
    invalidateMcpToolCache();
  } catch (error) {
    return fail(publicFrontOAuthError(error));
  }

  return clearOAuthCookies(
    NextResponse.redirect(
      new URL("/config/connections?front=connected", req.url),
    ),
  );
}
