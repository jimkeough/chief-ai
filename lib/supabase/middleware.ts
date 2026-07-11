import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

type CookieItem = { name: string; value: string; options: CookieOptions };

// Refreshes the auth session and redirects unauthenticated users to /login.
// Single-user deployment: being signed in IS the authorization — no allowlist.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/login" ||
    path === "/changelog" ||
    path === "/manifest.webmanifest" ||
    path.startsWith("/auth/") ||
    path.startsWith("/icon") ||
    path.startsWith("/apple-icon") ||
    // First-render setup: the login page's pre-auth concierge. Each route
    // guards itself (health is read-only status; migrate/create-user refuse
    // to run once the instance is claimed).
    path.startsWith("/api/setup/");

  // Env not wired yet (fresh deploy, or vars added without a redeploy): there
  // is no session to refresh. Let the public setup surface render its
  // plain-language explanation instead of crashing to a blank 500.
  if (!supabaseUrl() || !supabaseAnonKey()) {
    if (isPublic) return response;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieItem[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Already signed in but sitting on /login → send to the app.
  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
