// Where Chief's dev mode edits: the repo + Vercel project THIS deployment runs
// from. Because the app already lives on Vercel + GitHub, the identity is free —
// Vercel injects it as system env vars at runtime (System Environment Variables,
// on by default). We read those first; for local / non-Vercel dev we fall back
// to the optional `devmode.repo` setting ("owner/repo"). Nothing here is a
// credential — it's just identity, so the dev prompt can name the exact repo
// instead of guessing or asking.

import { getSetting } from "@/lib/settings";

export type DeployTarget = {
  owner: string | null;
  repo: string | null;
  /** "owner/repo", or null when unknown. */
  slug: string | null;
  /** The branch PRs target / production deploys from. Defaults to "main". */
  defaultBranch: string;
  /** Vercel project id, when running on Vercel. */
  projectId: string | null;
  /** Production URL (e.g. "chief.example.com"), when running on Vercel. */
  productionUrl: string | null;
  /** The branch/ref this running instance was built from, when on Vercel. */
  currentRef: string | null;
  /** How the repo identity was resolved. */
  source: "vercel-env" | "config" | "none";
};

function env(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Resolve the repo/project this deployment edits. Best-effort: a missing repo
 *  identity is reported (source "none") rather than thrown, so the dev prompt
 *  can tell the user to set `devmode.repo` instead of the chat breaking. */
export async function getDeployTarget(): Promise<DeployTarget> {
  const projectId = env("VERCEL_PROJECT_ID");
  const productionUrl = env("VERCEL_PROJECT_PRODUCTION_URL");
  const currentRef = env("VERCEL_GIT_COMMIT_REF");
  const base = { projectId, productionUrl, currentRef, defaultBranch: "main" };

  const owner = env("VERCEL_GIT_REPO_OWNER");
  const repo = env("VERCEL_GIT_REPO_SLUG");
  if (owner && repo) {
    return { ...base, owner, repo, slug: `${owner}/${repo}`, source: "vercel-env" };
  }

  // Local / non-Vercel fallback: an owner/repo pasted into Config.
  const configured = (await getSetting("devmode.repo").catch(() => "")).trim();
  const match = configured.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (match) {
    const [, o, r] = match;
    return { ...base, owner: o, repo: r, slug: `${o}/${r}`, source: "config" };
  }

  return { ...base, owner: null, repo: null, slug: null, source: "none" };
}

/** A compact identity block for the dev system prompt. */
export function describeDeployTarget(t: DeployTarget): string {
  if (!t.slug) {
    return [
      "Target repo: UNKNOWN — this deployment didn't expose its GitHub repo, and no `devmode.repo` override is set.",
      "Before proposing any change, tell the user to set Config → Developer → \"Repo (owner/repo)\" so you edit the right repository. Do not guess a repo.",
    ].join("\n");
  }
  const lines = [
    `Target repo: ${t.slug} (default branch: ${t.defaultBranch}). Open every PR against this repo and base branch.`,
  ];
  if (t.productionUrl) lines.push(`Production URL: https://${t.productionUrl}`);
  if (t.projectId) lines.push(`Vercel project id: ${t.projectId}`);
  if (t.currentRef) lines.push(`This instance was built from ref: ${t.currentRef}`);
  return lines.join("\n");
}
