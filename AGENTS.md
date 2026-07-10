# AGENTS.md

## Cursor Cloud specific instructions

This repo is **Chief** (`ai-cockpit`): a single-user Next.js 15 (App Router) + React 19
PWA backed by **Supabase** (Postgres + Auth + RLS). There is also an optional,
operator-side microservice in `connect-service/` (Chief Connect) — it is **not**
required to run or test the main app and is out of scope for local dev.

Standard scripts live in `package.json` (`dev`, `build`, `start`, `typecheck`).
There is **no ESLint and no test suite** — `npm run typecheck` (`tsc --noEmit`) is
the only static check. `.env.local` is gitignored; general setup is in `README.md`.

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
- **AI features need a credential.** Chief chat / AI calls need one of
  `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN` (`vercel env pull`), or
  `ANTHROPIC_API_KEY`. The core loop (auth, projects, tasks, notes, inbox triage)
  works fine without any AI key.
- **Resetting data:** `supabase db reset` wipes the DB (including your login) and
  re-applies migrations + seed; you'll re-do the create-login onboarding after.
