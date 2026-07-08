// Version + upstream identity for the update system. Detection is
// version/release-driven, NOT commit-driven: a Vercel deploy-button clone has
// UNRELATED git history with upstream and is private, so the app can neither
// compare commit SHAs (they never match across unrelated histories) nor read
// its own repo's state via the API without a token. It CAN read upstream's
// PUBLIC releases — so we compare this build's version to the latest upstream
// release tag and surface "update available" from that.

import pkg from "@/package.json";

export const APP_VERSION: string = pkg.version;
export const UPSTREAM_REPO = "jim-homejab/ai-cockpit";

/** Parse "1.2.3" / "v1.2.3" into [1,2,3]; non-numeric parts become 0. */
function parts(v: string): number[] {
  return v
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/** True when `latest` is a strictly newer version than `current`. */
export function isNewer(current: string, latest: string): boolean {
  const a = parts(current);
  const b = parts(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (y > x) return true;
    if (y < x) return false;
  }
  return false;
}
