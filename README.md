# ai-cockpit — "Chief"

A self-hosted personal AI chief of staff. One user per deployment (your Vercel + your Supabase + your Anthropic key). Chief proposes; you approve.

## Start here

1. **`BUILD-BRIEF.md`** — the master build brief: architecture, port map from `jim-homejab/Email-wrapper`, data model, security rules, and six build phases.
2. **`handoff/`** — design source of truth from Claude Design (`HANDOFF.md` = tokens + intent, `Chief Design Spec.dc.html` = visual spec).

## Getting started (Phase 1)

1. Create a Supabase project and run the files in `supabase/migrations/` in
   order (dashboard SQL editor or `supabase db push`).
2. Create your one user: Dashboard → Authentication → Add user (email +
   password, autoconfirm). There is no sign-up flow by design.
3. `cp .env.example .env.local` and fill in the Supabase URL + anon key.
4. `npm install && npm run dev` → sign in at `http://localhost:3000`.

Build phases completed so far: **1** (skeleton, design system, PWA shell,
migrations, single-user auth).

## For Claude Code

Read `BUILD-BRIEF.md` in full, read `handoff/HANDOFF.md`, then execute the next
phase. Each phase must end runnable. Never commit secrets; `.env*` is
gitignored. Typecheck with `npx tsc --noEmit` before pushing.

Sovereign means sovereign: the app runs on the user's own Supabase, Vercel,
and Anthropic key — never provision shared/org infrastructure on their behalf.
Log every manual or confusing setup step in **`SETUP-FRICTION.md`**; that file
is the spec for the Phase 6 onboarding concierge.
