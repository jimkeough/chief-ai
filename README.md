# ai-cockpit — "Chief"

A self-hosted personal AI chief of staff. One user per deployment (your Vercel + your Supabase + your Anthropic key). Chief proposes; you approve.

## Start here

1. **`BUILD-BRIEF.md`** — the master build brief: architecture, port map from `jim-homejab/Email-wrapper`, data model, security rules, and six build phases.
2. **`handoff/`** — design source of truth from Claude Design (`HANDOFF.md` = tokens + intent, `Chief Design Spec.dc.html` = visual spec).

## Getting started

1. Create a Supabase project and run the files in `supabase/migrations/` in
   order (dashboard SQL editor or `supabase db push`).
2. Create your one user: Dashboard → Authentication → Add user (email +
   password, autoconfirm). There is no sign-up flow by design.
3. `cp .env.example .env.local` and fill in the Supabase URL + anon key.
4. `npm install && npm run dev` → sign in at `http://localhost:3000`.

Build phases completed so far: **1** (skeleton, design system, PWA shell,
migrations, single-user auth) · **2** (core domain: projects with living
current-state records, tasks with waiting status, settings, journal, contacts,
communications log, knowledge base with hybrid search; Tasks & Projects
screens) · **3** (the Chief loop: streaming chat with the approve-first write
gate, proposal cards with undo, MCP broker, journaled executor).

**Existing deployments:** after pulling a phase, run the new files in
`supabase/migrations/` (anything newer than what you've applied) in the SQL
editor.

### Email (the Inbox)

Two ways to connect, both storing credentials only in your own database:

1. **App password (the easy path, any provider).** Turn on 2-Step
   Verification, generate an app password (Gmail:
   myaccount.google.com/apppasswords), and paste it into the Inbox screen's
   connect form. Works over IMAP/SMTP with Gmail, Outlook, Fastmail, iCloud —
   the form's advanced fields take any host. Trade-off: an app password is a
   full-mailbox credential (revocable at your provider any time).
2. **Google OAuth (the scoped path).** Reads through Google's official Gmail
   remote MCP server with a grant limited to mail scopes. You bring your own
   Google Cloud OAuth client — step-by-step in `.env.example` under the Google
   section; set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, deploy, then tap
   Connect with Google OAuth.

Either way the write gate is identical: archive is a reversible standard card
(with Undo), and **Reply actually sends** — only ever behind the copper
slide-to-send card, through the one executor.

## For Claude Code

Read `BUILD-BRIEF.md` in full, read `handoff/HANDOFF.md`, then execute the next
phase. Each phase must end runnable. Never commit secrets; `.env*` is
gitignored. Typecheck with `npx tsc --noEmit` before pushing.

Sovereign means sovereign: the app runs on the user's own Supabase, Vercel,
and Anthropic key — never provision shared/org infrastructure on their behalf.
Log every manual or confusing setup step in **`SETUP-FRICTION.md`**; that file
is the spec for the Phase 6 onboarding concierge.
