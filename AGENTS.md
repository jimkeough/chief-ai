# AGENTS.md

## Cursor Cloud specific instructions

This repo is **Chief** (`ai-cockpit`): a single-user Next.js 15 (App Router) + React 19
PWA backed by **Supabase** (Postgres + Auth + RLS). Pipedream Connect runs
directly in the main app with owner-supplied, Vault-backed project credentials.

Standard scripts live in `package.json` (`dev`, `build`, `start`, `typecheck`).
There is **no ESLint or general test suite** — `npm run typecheck`
(`tsc --noEmit`) is the main static check. Focused regression checks include
`npm run test:document-import` and `npm run test:pipedream-front`. `.env.local`
is gitignored; general setup is in `README.md`.

### Release discipline

- Version bumps are **not** required on every PR. Bump only when you intend to
  ship a release to deployed installs: run `npm run release:patch` (or
  `release:minor` / `release:major`). Merging a version change to `main` is what
  cuts the GitHub release the in-app update check reads, so keep routine PRs at
  the current version and move fast. When you do bump, those commands keep
  `package.json` and `package-lock.json` synchronized.
- `package.json` is the single source of truth. Runtime UI and release automation
  read it directly; do not copy the current version into `README.md`, `TRUST.md`,
  `CLAUDE.md`, or other helper files.
- Before finishing a PR, run `npm run release:check` (it validates the version
  format and that the lockfile + embedded updater workflow stay in sync — it no
  longer enforces a version increase) and review whether the change also requires
  updates to `README.md` (user/setup behavior), `TRUST.md` (security, privacy, or
  data-flow contract), or other agent guidance.
- Changes to `.github/workflows/upstream-updates.yml` must also update the embedded
  copy in `lib/updater-workflow.ts`; run `npm run release:sync-updater`, and
  `release:check` will enforce exact parity.
- The document importer extracts bounded semantic entities, then compiles them
  through `toProposedAction`; it never asks the model for executable action
  payloads. When adding or renaming a write action, classify it explicitly in
  `DOCUMENT_IMPORT_ACTION_POLICY`. Its exhaustive `WriteActionKey` mapping must
  keep typechecking. Never duplicate write-action argument schemas in the
  extraction contract.

### Running the app locally (Supabase runs locally via the CLI)

The VM snapshot already has Node, Docker, and the Supabase CLI installed; the
startup script runs `npm install`. To bring the app up:

1. **Start the Docker daemon** (needed for local Supabase; not running by default):
   `sudo dockerd &` then `sudo chmod 666 /var/run/docker.sock` (so `docker`/the
   Supabase CLI work without sudo). Skip if `docker info` already succeeds.
2. **Start Supabase:** `supabase start` (from repo root). This applies everything
   in `supabase/migrations/` and then runs `supabase/seed.sql`. First run pulls
   images and takes a couple minutes; later starts are fast.
3. **Create `.env.local`** (gitignored) pointing at the local stack. The local
   Supabase keys are the fixed, well-known demo keys (same on every machine):
   ```
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
   POSTGRES_URL_NON_POOLING=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   ```
   (`supabase status` reprints these if needed.)
4. **`npm run dev`** → http://localhost:3000. **First render IS onboarding**: the
   login page detects an empty schema/no user and lets you create the single login
   in-app (there is no sign-up flow — the "claim" screen locks after the first
   user). Then sign in and use Home / Inbox / Projects / Tasks / Notes.

Useful: `http://localhost:3000/api/setup/health` reports env wiring, `schema`
(`ready`/`missing`), and user count. Supabase Studio is at http://localhost:54323.

### UI testing artifacts

- The owner dogfoods and manually tests UI changes. Do not run browser-based
  end-to-end/manual testing unless the user explicitly requests it; prefer the
  repository's automated checks.
- When visual evidence is explicitly requested, use concise screenshots of the
  final rendered state. Do not create or attach screen recordings solely as a
  walkthrough for the user.
- Screen recordings are still appropriate as temporary debugging tools when
  motion or interaction behavior needs investigation.

### Non-obvious gotchas

- **Grants / `supabase/seed.sql`:** the SQL migrations intentionally contain **no
  `GRANT` statements** — on hosted Supabase the `anon`/`authenticated`/`service_role`
  roles get DML on new `public` tables via that project's default privileges. Some
  local Supabase CLI stacks create `postgres`-owned tables whose default privileges
  only give TRUNCATE/REFERENCES/TRIGGER to those roles, so every read/write fails
  with `permission denied for table ...` (and the Notes tab shows a bogus "database
  update needed" dialog). `supabase/seed.sql` reproduces the hosted grants and is
  auto-applied by `supabase start` / `supabase db reset`. Do not delete it for local
  dev, and do not add grants to the migrations (they belong only in local seed).
- **AI features need a credential.** Chief chat (the `/chief` conversation, the
  floating `C` launcher, Home narrative, and the approve-first proposal loop)
  needs one of `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN` (`vercel env pull`), or
  `ANTHROPIC_API_KEY`; the default provider is the Vercel AI Gateway
  (`lib/ai.ts`). The core loop (auth, projects, tasks, notes, inbox triage) works
  fine without any AI key. `AI_GATEWAY_API_KEY` is provided as a Cursor secret
  and injected into the VM env — it is read straight from `process.env`, so if
  the secret is added mid-session you must **restart `npm run dev`** for the
  already-running server to pick it up.
- **Resetting data:** `supabase db reset` wipes the DB (including your login) and
  re-applies migrations + seed; you'll re-do the create-login onboarding after.
