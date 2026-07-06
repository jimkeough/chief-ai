// Google OAuth callback: verify the state nonce, exchange the code, store the
// grant (RLS-scoped to the signed-in user), and land back on the Inbox.

import { NextResponse, type NextRequest } from "next/server";
import { getAuthed } from "@/lib/auth";
import { exchangeCodeAndStore } from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await getAuthed())) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("google_oauth_state")?.value;

  const fail = (message: string) =>
    NextResponse.redirect(
      new URL(`/inbox?error=${encodeURIComponent(message)}`, req.url),
    );

  if (url.searchParams.get("error")) {
    return fail(`Google returned: ${url.searchParams.get("error")}`);
  }
  if (!code) return fail("Google did not return an authorization code.");
  if (!state || !cookieState || state !== cookieState) {
    return fail("The connection attempt expired — try Connect Gmail again.");
  }

  try {
    await exchangeCodeAndStore(url.origin, code);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Connection failed.");
  }

  const res = NextResponse.redirect(new URL("/inbox", req.url));
  res.cookies.delete("google_oauth_state");
  return res;
}
