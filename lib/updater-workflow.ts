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

export const UPDATER_WORKFLOW_YAML = "# Updates-as-proposals: for CLONES/FORKS of Chief, this workflow checks the\n# upstream repo weekly and opens a PR in YOUR repo when upstream main has moved\n# — the trust contract applied to the app's own evolution: nothing lands until\n# you review and merge. It no-ops on the upstream repo itself.\n#\n# Security releases arrive the same way — merge promptly when a PR mentions one.\n\nname: Upstream updates\n\non:\n  schedule:\n    - cron: \"17 9 * * 1\" # weekly, Monday 09:17 UTC\n  workflow_dispatch: {}\n\npermissions:\n  contents: write\n  pull-requests: write\n  issues: write\n  # Without this, pushing a branch that touches .github/workflows/* (which an\n  # upstream update almost always does) is rejected with \"refusing to allow a\n  # GitHub App to create or update workflow ... without `workflows` permission\"\n  # — a hard gate that the repo's \"Read and write permissions\" setting does\n  # NOT cover; it's only grantable from inside the workflow file itself.\n  workflows: write\n\nenv:\n  UPSTREAM: jim-homejab/ai-cockpit\n\njobs:\n  check:\n    # Never run on the upstream repo itself.\n    if: github.repository != 'jim-homejab/ai-cockpit'\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0\n\n      - name: Fetch upstream\n        run: |\n          git remote add upstream \"https://github.com/${UPSTREAM}.git\"\n          git fetch upstream main\n\n      - name: Check for new commits\n        id: diff\n        run: |\n          BEHIND=$(git rev-list --count HEAD..upstream/main)\n          echo \"behind=$BEHIND\" >> \"$GITHUB_OUTPUT\"\n          echo \"Behind upstream by $BEHIND commit(s).\"\n\n      - name: Create update branch\n        if: steps.diff.outputs.behind != '0'\n        run: |\n          git config user.name \"chief-updates[bot]\"\n          git config user.email \"noreply@github.com\"\n          git checkout -B chief/upstream-update\n          # Take upstream's version on any overlap. Vercel's deploy-button clone\n          # does NOT share git history with upstream, so a plain merge refuses\n          # (\"unrelated histories\"); --allow-unrelated-histories + -X theirs lets\n          # the first update apply cleanly (later updates are ordinary merges,\n          # since upstream becomes an ancestor once this merges). User code edits\n          # are discouraged — config lives in the DB — so favoring upstream is\n          # the right call. The abort can't itself fail the job (|| true).\n          git merge --no-edit --allow-unrelated-histories -X theirs upstream/main || {\n            echo \"MERGE_CONFLICT=1\" >> \"$GITHUB_ENV\"\n            git merge --abort 2>/dev/null || true\n          }\n\n      - name: Push and open PR\n        if: steps.diff.outputs.behind != '0' && env.MERGE_CONFLICT != '1'\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: |\n          git push -f origin chief/upstream-update || {\n            echo \"::error::Push denied. If the log above says 'without \\`workflows\\` permission', this workflow's own YAML is missing workflows:write (should already be fixed if you're on a current version — re-enable auto-updates to recommit it). Otherwise an org policy may be capping GITHUB_TOKEN — check Settings > Actions > General > Workflow permissions.\"\n            exit 1\n          }\n          gh pr list --head chief/upstream-update --state open --json number \\\n            --jq 'length' | grep -q '^0$' || exit 0\n          gh pr create \\\n            --title \"Chief update: ${{ steps.diff.outputs.behind }} new upstream commit(s)\" \\\n            --body \"Upstream Chief has moved. Review the diff — new migrations are listed under \\`supabase/migrations/\\` and must be run after merging. Nothing changes until you merge this. Compare: https://github.com/${UPSTREAM}/compare/\" \\\n            --base main --head chief/upstream-update || {\n            echo \"::error::Couldn't open the PR — this almost always means 'Allow GitHub Actions to create and approve pull requests' isn't checked under Settings > Actions > General > Workflow permissions (a hard gate the workflow file can't override). Check it, then re-run — the chief/upstream-update branch is already pushed.\"\n            exit 1\n          }\n\n      - name: Open conflict issue instead\n        if: env.MERGE_CONFLICT == '1'\n        env:\n          GH_TOKEN: ${{ github.token }}\n        run: |\n          gh issue list --search \"Upstream update conflict in:title\" --state open --json number --jq 'length' | grep -q '^0$' || exit 0\n          gh issue create \\\n            --title \"Upstream update conflict\" \\\n            --body \"An upstream Chief update couldn't be merged automatically because of local changes. Merge https://github.com/${UPSTREAM} main into your repo manually.\" || {\n            echo \"::error::Couldn't open the conflict issue — check that GitHub Actions has issue-write access under Settings > Actions > General > Workflow permissions.\"\n            exit 1\n          }\n";

export type UpdatesInfo = {
  provider: string | null;
  repoOwner: string | null;
  repoSlug: string | null;
  /** One-tap GitHub "new file" URL that commits the updater into the user's own
   *  repo, content prefilled. Null when no GitHub repo can be identified (e.g.
   *  local dev, or a non-GitHub provider). */
  enableUrl: string | null;
};

/** Identify the deployment's own git repo from Vercel's injected system env and
 *  build the one-tap "enable updates" link. All server-side; never exposes a
 *  token (there is none — the user commits the file themselves). */
export function getUpdatesInfo(): UpdatesInfo {
  const provider = process.env.VERCEL_GIT_PROVIDER ?? null;
  const repoOwner = process.env.VERCEL_GIT_REPO_OWNER ?? null;
  const repoSlug = process.env.VERCEL_GIT_REPO_SLUG ?? null;
  let enableUrl: string | null = null;
  if (provider === "github" && repoOwner && repoSlug) {
    enableUrl =
      `https://github.com/${repoOwner}/${repoSlug}/new/main` +
      `?filename=${UPDATER_WORKFLOW_PATH}` +
      `&value=${encodeURIComponent(UPDATER_WORKFLOW_YAML)}`;
  }
  return { provider, repoOwner, repoSlug, enableUrl };
}
