// The updater workflow that delivers upstream Chief updates as review-first
// PRs (see .github/workflows/upstream-updates.yml). It lives here as a string
// ON PURPOSE: Vercel's deploy-button clone strips .github/workflows/ (its
// GitHub App lacks the `workflow` scope), so the file never lands in a user's
// repo — the update pipeline would silently never exist. We ship the content
// here (survives cloning) and let the user commit it into their OWN repo in one
// tap via Config → Software updates (they commit as themselves, satisfying the
// workflow scope). KEEP IN SYNC with the workflow file; this is the source of
// truth users actually receive.

export const UPDATER_WORKFLOW_PATH = ".github/workflows/upstream-updates.yml";

/** The branch the updater workflow force-pushes the prepared update onto.
 *  MUST match the branch name in UPDATER_WORKFLOW_YAML / upstream-updates.yml. */
export const UPDATE_BRANCH = "chief/upstream-update";

export const UPDATER_WORKFLOW_YAML = "# Updates-as-proposals: for CLONES/FORKS of Chief, this workflow checks the\n# upstream repo weekly and PREPARES an update in YOUR repo when upstream main\n# has moved — the trust contract applied to the app's own evolution: nothing\n# lands until you review and merge. It no-ops on the upstream repo itself.\n#\n# The reliable half of this job is PUSHING the `chief/upstream-update` branch.\n# Auto-opening the PR is best-effort: GitHub gates a workflow's ability to open\n# PRs (Settings > Actions > \"Allow GitHub Actions to create and approve pull\n# requests\"), and that gate can misfire even when enabled — so a failed\n# auto-open is a warning, NOT a job failure. Either way Chief → Config →\n# Software updates gives you a one-tap \"Review & merge\" link to the pushed\n# branch (a PR you open yourself is never gated). Merging deploys the update.\n#\n# Security releases arrive the same way — merge promptly when a PR mentions one.\n\nname: Upstream updates\n\non:\n  schedule:\n    - cron: \"17 9 * * 1\" # weekly, Monday 09:17 UTC\n  workflow_dispatch: {}\n\npermissions:\n  contents: write\n  pull-requests: write\n  issues: write\n\nenv:\n  UPSTREAM: jimkeough/chief-ai\n\njobs:\n  check:\n    # Never run on the upstream repo itself.\n    if: github.repository != 'jimkeough/chief-ai'\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n\n      - name: Fetch upstream\n        run: |\n          git remote add upstream \"https://github.com/${UPSTREAM}.git\"\n          git fetch upstream main\n\n      - name: Check for new commits\n        id: diff\n        run: |\n          BEHIND=$(git rev-list --count HEAD..upstream/main)\n          echo \"behind=$BEHIND\" >> \"$GITHUB_OUTPUT\"\n          echo \"Behind upstream by $BEHIND commit(s).\"\n\n      - name: Create update branch\n        if: steps.diff.outputs.behind != '0'\n        run: |\n          git config user.name \"chief-updates[bot]\"\n          git config user.email \"noreply@github.com\"\n          git checkout -B chief/upstream-update\n          # Take upstream's version on any overlap. Vercel's deploy-button clone\n          # does NOT share git history with upstream, so a plain merge refuses\n          # (\"unrelated histories\"); --allow-unrelated-histories + -X theirs lets\n          # the first update apply cleanly (later updates are ordinary merges,\n          # since upstream becomes an ancestor once this merges). User code edits\n          # are discouraged — config lives in the DB — so favoring upstream is\n          # the right call. The abort can't itself fail the job (|| true).\n          git merge --no-edit --allow-unrelated-histories -X theirs upstream/main || {\n            echo \"MERGE_CONFLICT=1\" >> \"$GITHUB_ENV\"\n            git merge --abort 2>/dev/null || true\n          }\n\n      - name: Strip workflow-file changes\n        if: steps.diff.outputs.behind != '0' && env.MERGE_CONFLICT != '1'\n        run: |\n          # The default GITHUB_TOKEN can NEVER create or update files under\n          # .github/workflows/ — a hard, unconfigurable GitHub restriction (no\n          # permissions: key grants it; it exists so a workflow can't rewrite\n          # other workflows to escalate itself). Pushing a branch that touches\n          # that path is unconditionally rejected. So: drop any such changes\n          # from this merge before pushing. upstream-updates.yml itself is\n          # updated through the separate \"Enable auto-updates\" / \"re-commit\n          # the workflow\" link in Config instead (the user pushes that one as\n          # themselves, which isn't subject to this restriction).\n          CHANGED=$(git diff --name-only HEAD^1 HEAD -- .github/workflows/ || true)\n          if [ -n \"$CHANGED\" ]; then\n            echo \"Excluding upstream workflow-file changes from this PR:\"\n            echo \"$CHANGED\"\n            echo \"$CHANGED\" | while IFS= read -r f; do\n              if git cat-file -e \"HEAD^1:$f\" 2>/dev/null; then\n                git checkout HEAD^1 -- \"$f\"\n              else\n                git rm -f \"$f\" >/dev/null 2>&1 || rm -f \"$f\"\n              fi\n            done\n            git add -A .github/workflows/\n            git commit --amend --no-edit\n          fi\n\n      - name: Push and open PR\n        if: steps.diff.outputs.behind != '0' && env.MERGE_CONFLICT != '1'\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: |\n          git push -f origin chief/upstream-update || {\n            echo \"::error::Push denied — check Settings > Actions > General > Workflow permissions: 'Read and write permissions' must be selected. (Changes under .github/workflows/ are already stripped from this branch, so this shouldn't be the old 'workflows permission' error.)\"\n            exit 1\n          }\n          gh pr list --head chief/upstream-update --state open --json number \\\n            --jq 'length' | grep -q '^0$' || exit 0\n          # Best-effort: try to open the PR, but NEVER fail the job if we can't.\n          # The branch is pushed and ready; Chief's Software-updates card links\n          # straight to it (\"Review & merge\"), and a PR you open yourself is\n          # never subject to the Actions gate. A red X here would be misleading.\n          gh pr create \\\n            --title \"Chief update: ${{ steps.diff.outputs.behind }} new upstream commit(s)\" \\\n            --body \"Upstream Chief has moved. Review the diff — new migrations are listed under \\`supabase/migrations/\\` and must be run after merging. Nothing changes until you merge this. Compare: https://github.com/${UPSTREAM}/compare/. Note: any changes to files under \\`.github/workflows/\\` are excluded from this PR (GitHub Actions can never push those) — check upstream separately if you rely on other CI workflows.\" \\\n            --base main --head chief/upstream-update \\\n            && echo \"Opened update PR.\" \\\n            || echo \"::warning::Branch \\`chief/upstream-update\\` is pushed and ready, but auto-opening the PR didn't succeed (GitHub gates this, and it can misfire even when enabled). Open it in one tap from Chief → Config → Software updates → Review & merge — a PR you open yourself is never gated.\"\n\n      - name: Open conflict issue instead\n        if: env.MERGE_CONFLICT == '1'\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: |\n          gh issue list --search \"Upstream update conflict in:title\" --state open --json number --jq 'length' | grep -q '^0$' || exit 0\n          gh issue create \\\n            --title \"Upstream update conflict\" \\\n            --body \"An upstream Chief update couldn't be merged automatically because of local changes. Merge https://github.com/${UPSTREAM} main into your repo manually.\" || {\n            echo \"::error::Couldn't open the conflict issue — check that GitHub Actions has issue-write access under Settings > Actions > General > Workflow permissions.\"\n            exit 1\n          }\n";

export type UpdatesInfo = {
  provider: string | null;
  repoOwner: string | null;
  repoSlug: string | null;
  /** One-tap GitHub "new file" URL that commits the updater into the user's own
   *  repo, content prefilled. Null when no GitHub repo can be identified (e.g.
   *  local dev, or a non-GitHub provider). */
  enableUrl: string | null;
  /** The repo's GitHub home. Null off a GitHub deployment. */
  repoUrl: string | null;
  /** The repo's Settings page — where the user flips visibility to Public
   *  (required so Vercel Hobby will deploy the updater's merge commits; see
   *  the "why public" note in the Software updates card). */
  settingsUrl: string | null;
  /** The updater workflow's Actions page: the user taps "Run workflow" to
   *  prepare the update branch on demand (also the recovery path if GitHub has
   *  auto-paused the weekly cron after 60 days of repo inactivity). */
  runWorkflowUrl: string | null;
  /** The compare page for the pushed update branch, PR form pre-expanded. This
   *  is the robust "Review & merge" target: it shows the diff and a Create-PR
   *  button (or links to the existing PR). A PR the user opens here is never
   *  subject to GitHub's Actions PR gate — so it works even when the workflow's
   *  own auto-open step is blocked. Null off a GitHub deployment. */
  createPrUrl: string | null;
  /** The repo's open pull requests — where an auto-opened update PR lands. */
  reviewUrl: string | null;
};

/** Identify the deployment's own git repo from Vercel's injected system env and
 *  build the deep links the Software updates card uses. All server-side and
 *  purely string-built from the repo identity — never exposes a token (there is
 *  none; every action lands the user in their OWN authenticated GitHub). */
export function getUpdatesInfo(): UpdatesInfo {
  const provider = process.env.VERCEL_GIT_PROVIDER ?? null;
  const repoOwner = process.env.VERCEL_GIT_REPO_OWNER ?? null;
  const repoSlug = process.env.VERCEL_GIT_REPO_SLUG ?? null;
  const onGithub = provider === "github" && Boolean(repoOwner && repoSlug);
  const base = onGithub ? `https://github.com/${repoOwner}/${repoSlug}` : null;
  return {
    provider,
    repoOwner,
    repoSlug,
    enableUrl: base
      ? `${base}/new/main?filename=${UPDATER_WORKFLOW_PATH}` +
        `&value=${encodeURIComponent(UPDATER_WORKFLOW_YAML)}`
      : null,
    repoUrl: base,
    settingsUrl: base ? `${base}/settings` : null,
    runWorkflowUrl: base
      ? `${base}/actions/workflows/upstream-updates.yml`
      : null,
    createPrUrl: base
      ? `${base}/compare/main...${UPDATE_BRANCH}?expand=1`
      : null,
    reviewUrl: base ? `${base}/pulls` : null,
  };
}

/** Is the deployment's own repo public? Updates only auto-deploy on Vercel's
 *  free (Hobby) plan when the repo is public — a private repo blocks the
 *  updater's bot/merge commits (they aren't authored by a project collaborator,
 *  which Hobby doesn't support). A Chief clone holds no secrets (.env is
 *  gitignored; all credentials live in the user's Supabase), so public is safe.
 *
 *  Read with NO token against the public GitHub API: 200 → public, 404 →
 *  private-or-absent, anything else (rate limit, network) → null = "unknown".
 *  Callers treat null as "don't nag." */
export async function getRepoPublic(
  owner: string | null,
  slug: string | null,
): Promise<boolean | null> {
  if (!owner || !slug) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${slug}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "chief-update-check",
      },
      cache: "no-store",
    });
    if (res.status === 200) {
      const data = (await res.json()) as { private?: boolean };
      // A public repo is reachable unauthenticated and reports private:false.
      return data.private === false;
    }
    if (res.status === 404) return false; // private (or doesn't exist)
    return null; // rate-limited / transient — unknown
  } catch {
    return null;
  }
}
