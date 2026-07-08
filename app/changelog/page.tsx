// Public changelog — release notes for Chief, readable without signing in.
// It's the human-facing companion to the in-app "update available" card (which
// links here): the card is per-user and actionable ("get this into YOUR repo");
// this page is generic and informational ("here's what changed"). It reads the
// UPSTREAM repo's public GitHub releases — the same source the version check
// uses — so every deployment shows the same list with no token and no auth.

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { APP_VERSION, UPSTREAM_REPO } from "@/lib/version";

export const runtime = "nodejs";
// Cache the release list for an hour — release notes change rarely and this
// keeps us well under GitHub's unauthenticated rate limit.
export const revalidate = 3600;

export const metadata = {
  title: "Chief — Changelog",
  description: "What's new in Chief, release by release.",
};

type Release = {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  html_url?: string;
  published_at?: string | null;
  prerelease?: boolean;
  draft?: boolean;
};

async function getReleases(): Promise<Release[] | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${UPSTREAM_REPO}/releases?per_page=30`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "chief-changelog",
        },
        next: { revalidate },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Release[];
    return data.filter((r) => !r.draft);
  } catch {
    return null;
  }
}

function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function ChangelogPage() {
  const releases = await getReleases();
  const releasesUrl = `https://github.com/${UPSTREAM_REPO}/releases`;

  return (
    <main className="mx-auto max-w-[720px] px-5 py-12 pb-24">
      <header className="mb-10">
        <a
          href="/"
          className="text-[12px] uppercase tracking-wide text-ink-3 hover:text-ink-2"
        >
          ← Chief
        </a>
        <h1
          className="mt-3 text-[26px] font-semibold text-ink"
          style={{ fontFamily: "var(--font-newsreader), serif" }}
        >
          Changelog
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-2">
          What&apos;s new in Chief, release by release. You&apos;re running{" "}
          <span className="font-mono text-[12.5px] text-ink">v{APP_VERSION}</span>
          .
        </p>
      </header>

      {releases === null ? (
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          Couldn&apos;t load the release list right now. See every release on{" "}
          <a
            href={releasesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal underline"
          >
            GitHub
          </a>
          .
        </p>
      ) : releases.length === 0 ? (
        <p className="text-[13.5px] leading-relaxed text-ink-2">
          No releases published yet.
        </p>
      ) : (
        <ol className="flex flex-col gap-8">
          {releases.map((r, i) => {
            const version = (r.tag_name ?? r.name ?? "").replace(/^v/i, "");
            const date = fmtDate(r.published_at);
            return (
              <li
                key={r.tag_name ?? r.html_url ?? i}
                className="rounded-card border p-5"
                style={{
                  borderColor: "var(--hairline)",
                  background: "var(--surface)",
                }}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-[18px] font-semibold text-ink">
                    {version ? `v${version}` : (r.name ?? "Release")}
                  </h2>
                  {r.prerelease ? (
                    <span className="text-[11px] uppercase tracking-wide text-ink-3">
                      pre-release
                    </span>
                  ) : null}
                  {date ? (
                    <span className="font-mono text-[12px] text-ink-3">
                      {date}
                    </span>
                  ) : null}
                </div>
                {r.body && r.body.trim() ? (
                  <div className="chief-prose mt-3 text-[13.5px] text-ink-2">
                    <Markdown remarkPlugins={[remarkGfm]}>{r.body}</Markdown>
                  </div>
                ) : (
                  <p className="mt-3 text-[13px] text-ink-3">
                    No notes for this release.{" "}
                    {r.html_url ? (
                      <a
                        href={r.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal underline"
                      >
                        View on GitHub
                      </a>
                    ) : null}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
