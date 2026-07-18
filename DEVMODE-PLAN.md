# Chief dev-mode — build plan (for review)

Status: **decisions resolved (2026-07-18); Phase A implemented.** Companion to `DEVLOOP-PLAN.md`, which
established the review-gated GitHub → Vercel loop (Chief opens a PR, you merge,
Vercel deploys). That plan wired the *capability*; this plan adds a **dedicated
"Update app" entry** so the capability is fast, precise, and hard to misfire.

## 0. What was asked, and the decisions already taken

> Add a separate "Update app" button that's preloaded — Chief should know the
> exact repo, the Vercel project, and have Supabase edit abilities. Make the
> button work smoothly. Prefer standard connections over fiddly setup.

Locked in review:

- **Build a dedicated dev-mode entry**, planned here before any code.
- **Supabase = reads auto-run + schema changes via migration-file PR.** No live
  production SQL from Chief.
- **First-party GitHub + Vercel MCP drive the loop** (not Pipedream). Pipedream
  stays for the long tail of other apps.

## 1. "Do we need a manual MCP connection, or is there an easier way?"

This is the crux, so answer it first. Because the app **already lives on Vercel
and GitHub**, three of the four things the loop needs are already free — only
one genuinely requires a credential.

| Loop need | Already free? | How |
| --- | --- | --- |
| **Deploy on change** | ✅ free | Vercel's existing GitHub link auto-builds every pushed branch / merged PR. No new connection. |
| **Repo + project identity** | ✅ free | Vercel injects `VERCEL_GIT_REPO_OWNER` / `VERCEL_GIT_REPO_SLUG` / `VERCEL_PROJECT_ID` / `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_GIT_COMMIT_REF` at runtime (System Env Vars, on by default). Read server-side. |
| **Basic deploy health** | ✅ mostly free | `check_routes` (already shipped) probes the preview URL for status + timing with no API. The PR's own Vercel status check is readable through the GitHub connection. |
| **Repo writes** (push branch, commit, open PR) | ❌ needs a credential | Vercel's GitHub link is **deploy-only** — it does not grant the running app push access. This is the one thing that requires setup. |

So the honest answer: **there is no fully zero-setup path, but the required
setup is a single credential — GitHub write access — not a multi-connector
dance.** Two ways to grant it:

- **(A) First-party GitHub MCP via OAuth** — the chosen path. Authorize GitHub
  once in Settings → Connections · Advanced · Direct MCP (App field `github`).
  Reuses the broker, the approve-first gate, and the curated cards already built
  in `lib/tool-enrichments.ts`. **One authorize step; then done.**
- **(B) Native GitHub actions via a stored token** — a fine-grained PAT (scoped
  to just this repo: Contents + Pull Requests write) pasted into a Config field
  and kept in Vault, exactly like `vercel.bypass_secret` today. Chief calls the
  four REST endpoints (create branch, commit files, open PR, read file) as
  *native* write actions with first-class cards — no external MCP server to stay
  up, no tool-name drift, repo auto-detected. Slightly more code (four endpoints),
  arguably *less* user setup (paste one token vs. an OAuth dance).

**Recommendation:** go with **(A)** as decided — it's one step and reuses
everything. Keep **(B)** noted as the fallback if the GitHub MCP's tool coverage
or uptime disappoints; the two are swappable behind the same approval cards.
Deeper Vercel reads (build logs, runtime errors) are an *optional* add — start
with `check_routes` + the PR status check and connect Vercel MCP later only if
you want log-level detail.

**No, we cannot reuse the updater's token:** `.github/workflows/upstream-updates.yml`
runs with GitHub Actions' `GITHUB_TOKEN`, which lives in CI and is never
available to the running app. Repo writes need the app's own credential.

## 2. The dedicated "Update app" entry

A separate launcher (a button in Config, or a small "Update this app" affordance)
that opens Chief in **dev mode** — a distinct context, not a new chat surface.
`/api/chief` already accepts a `page` context; add `mode: "dev"` (or
`page.route: "/dev"`) that changes three things:

- **Persona.** Swap the ~4–6k-token chief-of-staff prompt (projects, tasks,
  contacts, memory, "help them run their work") for a focused **engineer**
  prompt. The general prompt actively pulls Chief toward "I'm a chief of staff,
  not a coder" — that framing was the root cause of the original denial.
- **Tools.** Attach GitHub writes + Vercel/Supabase reads; **drop** Gmail, Front,
  calendar, the write-action set for tasks/projects, and the workspace snapshot.
  Less noise, fewer tokens, a tighter trust surface.
- **Grounding.** Inject the auto-detected repo/project identity (§3) and the
  repo's own rules (a short digest of `AGENTS.md`/`CLAUDE.md`: run
  `npm run typecheck` + `release:check`, keep PRs small, migrations in
  `supabase/migrations/`).

The engineer prompt's spine: *read before you edit* (use GitHub read tools, never
guess file contents) → *propose a branch + commits + PR* (each a gated card) →
*after the preview builds, verify with `check_routes`* → *report status + timing*.
It never merges or deploys; your merge is the approval. It also keeps the
**data-change vs. code-change** distinction from PR #123.

## 3. Auto-detected identity (the "preloaded" part)

A small `lib/deploy-target.ts` reads the Vercel env vars into a typed
`DeployTarget { owner, repo, defaultBranch, projectId, productionUrl,
currentRef }`, with a Config-field fallback for local/non-Vercel dev. The dev
prompt states it outright: *"You are editing THIS deployment: `<owner>/<repo>`,
default branch `main`, Vercel project `<id>`, production `<url>`."* Result: Chief
never asks which repo, never opens a PR against the wrong one.

## 4. Tool set in dev mode

- **GitHub (writes, gated):** `create_branch`, `create_or_update_file`,
  `push_files`, `create_pull_request` — already enriched with good cards.
- **GitHub (reads, auto):** list/read files, list commits, PR + status/check
  reads — so Chief reads the real code and the PR's CI before acting.
- **Vercel (reads, auto):** `check_routes` now; deployment status / build logs /
  runtime errors if/when Vercel MCP is connected.
- **Supabase (reads, auto):** `list_tables`, `get_advisors`, `get_logs`,
  `generate_typescript_types` for diagnosis (see §5).
- **Fix to make first-party matching robust:** `findEnrichment` currently
  compares the app slug **case-sensitively**, so a connection whose App field is
  `GitHub` turns the capability on (the `canEditApp` check lowercases) but
  silently loses the curated cards. Make the match case-insensitive — a
  one-liner, worth doing regardless of dev mode.

## 5. Supabase: reads auto-run, schema changes ride the PR rail

Schema changes are **code**, not a live action: Chief writes a migration file in
`supabase/migrations/` inside the same PR, and it applies on merge/deploy exactly
like the repo already works (`supabase start` / hosted default privileges; see
`AGENTS.md` on grants living only in `seed.sql`). This keeps the
reversible-until-*you*-merge contract whole.

- **Yes:** Supabase read tools auto-run for diagnosis (advisors, logs, table
  list, generated types) — safe and genuinely useful when debugging a change.
- **No:** live `apply_migration` / `execute_sql` / `deploy_edge_function`
  against production. Those bypass the human-merge gate — the one irreversible
  footgun `DEVLOOP-PLAN.md` §6 deliberately avoided.
- **If ever wanted later:** gate live DB writes behind a `red` slide-to-confirm
  and target a Supabase **branch** database, never prod. Out of scope now.

## 6. Trust invariants (unchanged)

- Every repo write is a gated proposal; **you** merge; Vercel deploys. No
  autonomous deploy path is introduced.
- The GitHub credential (and any Vercel/Supabase token) is a new sensitive asset
  — Vault, write-only, never in model context, same pattern as
  `vercel.bypass_secret`.
- Dev mode narrows tools rather than widening them; the exfiltration guard and
  every existing gate still apply.
- `TRUST.md` gets one paragraph: dev mode + the GitHub credential's scope.

## 7. Suggested phasing

- **Phase A — identity + prompt.** `lib/deploy-target.ts`, the dev-mode branch in
  `buildChiefSystemPrompt`, the `mode: "dev"` path in `/api/chief`, and the
  case-insensitive `findEnrichment` fix. Ships the smart behavior with no new UI.
- **Phase B — the button.** The launcher in Config/Home that opens Chief in dev
  mode with a starter line and the identity preloaded.
- **Phase C — Supabase reads + migration convention.** Attach the Supabase read
  tools in dev mode; teach the prompt the migration-file convention.
- **Phase D — optional Vercel MCP deep reads.** Only if `check_routes` + PR
  status checks prove insufficient.

## 8. Open questions — RESOLVED (2026-07-18)

1. **Credential path:** ✅ **(A) first-party GitHub MCP now**, native-token path
   (B) kept in reserve.
2. **Button placement:** ✅ **Config → Developer** — an "Update this app" entry
   that opens Chief in dev mode.
3. **Local/non-Vercel dev:** ✅ **Build the fallback now.** Identity
   auto-detects from Vercel env; a `devmode.repo` setting (`owner/repo`) is the
   override for local/non-Vercel dev. Shipped as a normal setting so it renders
   in Config with no custom UI.
4. **Autonomy line:** ✅ **Keep "Chief opens a PR, you merge" — never
   auto-merge**, consistent with `DEVLOOP-PLAN.md` §10.4.

## 9. Phase A — what shipped

- `lib/deploy-target.ts` — `getDeployTarget()` reads `VERCEL_GIT_*` /
  `VERCEL_PROJECT_*` at runtime, falls back to the `devmode.repo` setting, else
  reports unknown identity.
- `lib/chief.ts` — a dedicated engineer system prompt (`mode: "dev"`) that
  injects the resolved identity, states the read → branch → PR → verify loop,
  the data-vs-code rule, the repo checks, and the Supabase reads-only /
  migration-file-PR convention. Skips the chief-of-staff workspace snapshot.
- `app/api/chief/route.ts` — reads `mode` from the request; in dev mode narrows
  brokered servers to GitHub/Vercel/Supabase, drops task/project/KB write+read
  tools (keeps `check_routes`), and passes the deploy target into the prompt.
- `lib/chief-intents.ts` + `app/components/ChiefProvider.tsx` — an `app.update`
  intent whose session sends `mode: "dev"` to the route (survives reload via the
  persisted session intent).
- `app/(app)/config/ConfigClient.tsx` — a **DEVELOPER** section with the
  "Update this app" button.
- `lib/settings.ts` — the optional `devmode.repo` override field.
- `lib/tool-enrichments.ts` — `findEnrichment` now matches the app slug
  case-insensitively, so `GitHub` vs `github` no longer silently drops the cards.

Deferred (Phase D): connecting Vercel MCP for build-log / runtime-error reads —
`check_routes` + the PR's Vercel status check cover the basics for now.
