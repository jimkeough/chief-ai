# ai-cockpit — "Chief"

A self-hosted personal AI chief of staff. One user per deployment (your Vercel + your Supabase + your Anthropic key). Chief proposes; you approve.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjim-homejab%2Fai-cockpit&project-name=chief&repository-name=chief&env=ANTHROPIC_API_KEY&envDescription=Your%20Anthropic%20API%20key%20powers%20Chief%20%E2%80%94%20create%20one%20at%20console.anthropic.com&envLink=https%3A%2F%2Fconsole.anthropic.com%2Fsettings%2Fkeys&products=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22supabase%22%2C%22integrationSlug%22%3A%22supabase%22%7D%5D)

**One-click path — two signups, Vercel + GitHub.** The button clones this repo
to your GitHub and creates the Vercel project (those are the only two accounts
you need), then **provisions a Supabase database on your own account through
the Vercel Marketplace — migrations run automatically, env vars injected**, so
there's no separate supabase.com signup. It asks for one thing: your Anthropic
API key. *(Rather not make a trip to console.anthropic.com? Leave it blank and,
after first render, switch to Vercel AI Gateway in Config → **AI — provider** =
`gateway` — usage then bills to your own Vercel account and no Anthropic key is
needed. See `TRUST.md`.)* After deploy: create your login (Supabase dashboard →
Authentication → Add user), sign in, and connect your email from the Inbox tab
with an app password. Everything runs on accounts you own; see `TRUST.md` for
exactly what that means.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjim-homejab%2Fai-cockpit&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,ANTHROPIC_API_KEY&envDescription=Your%20own%20Supabase%20project%20URL%20%2B%20anon%20key%2C%20and%20your%20Anthropic%20API%20key.&envLink=https%3A%2F%2Fgithub.com%2Fjim-homejab%2Fai-cockpit%2Fblob%2Fmain%2F.env.example)

Deploying your own copy: click the button (it clones this repo into your
GitHub and deploys to your Vercel), create a Supabase project + run the
migrations + add your one auth user (steps below), fill in the three env
vars, and sign in. Clones get updates as pull requests they review — see
`.github/workflows/upstream-updates.yml`.

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
