// GET /api/updates/status — is a newer Chief available? Compares this build's
// version to upstream's latest PUBLIC GitHub release (no auth, no token, reads
// only the public upstream — see lib/version.ts for why version, not commits).
// Fails soft: any hiccup returns "not behind" so the UI never nags wrongly.

import { getAuthed, unauthorized } from "@/lib/auth";
import { APP_VERSION, UPSTREAM_REPO, isNewer } from "@/lib/version";
import { getUpdatesInfo, getRepoPublic } from "@/lib/updater-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAuthed())) return unauthorized();

  // Is this deployment's OWN repo public? Updates can only auto-deploy on the
  // free Vercel plan when it is (see getRepoPublic). null = unknown → no nag.
  const { repoOwner, repoSlug } = getUpdatesInfo();
  const repoPublic = await getRepoPublic(repoOwner, repoSlug);

  const result = {
    current: APP_VERSION,
    latest: null as string | null,
    behind: false,
    releaseUrl: `https://github.com/${UPSTREAM_REPO}/releases`,
    repoPublic,
  };

  try {
    const res = await fetch(
      `https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "chief-update-check",
        },
        cache: "no-store",
      },
    );
    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      const latest = (data.tag_name ?? "").replace(/^v/i, "").trim();
      if (latest) {
        result.latest = latest;
        result.behind = isNewer(APP_VERSION, latest);
        if (data.html_url) result.releaseUrl = data.html_url;
      }
    }
  } catch {
    // Network/API hiccup — leave "not behind"; the check retries next load.
  }

  return Response.json(result);
}
