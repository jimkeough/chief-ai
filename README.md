# ai-cockpit — "Chief"

A self-hosted personal AI chief of staff. One user per deployment (your Vercel + your Supabase + your Anthropic key). Chief proposes; you approve.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjimkeough%2Fchief-ai&project-name=chief&repository-name=chief&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22supabase%22%2C%22productSlug%22%3A%22supabase%22%2C%22protocol%22%3A%22storage%22%7D%5D)

**One-click path — two signups (Vercel + GitHub), zero questions.** This is
THE link for the landing site. The button clones this repo to your GitHub,
creates the Vercel project, and **provisions a Supabase database on your own
account through the Vercel Marketplace** (env vars injected — no separate
supabase.com signup, nothing to paste). It prompts for **no keys**: Chief runs
on **Vercel AI Gateway by default**, authenticated by your deployment's OIDC
token — no console.anthropic.com trip, nothing to paste. The one cost step:
the gateway needs a **payment method on your Vercel account** to run (free-tier
models are $0; premium models like Opus need paid credits, or bring your own
Anthropic key in Config). Zero-key, not zero-cost — but one account, not two.
*(Prefer prompts that go only to Anthropic? Flip Config → **AI — provider** =
`anthropic` and set your own key. See `TRUST.md`.)* Then open your deployment
— **first render IS onboarding**: the
app sets up its own database schema (one tap) and creates your login right
there; no visit to the Supabase dashboard. Sign in and connect your email from
the Inbox tab with an app password. Everything runs on accounts you own; see
`TRUST.md` for exactly what that means.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjimkeough%2Fchief-ai&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY&envDescription=Your%20own%20Supabase%20project%20URL%20%2B%20anon%20key%20(bring-your-own-project%20path).&envLink=https%3A%2F%2Fgithub.com%2Fjimkeough%2Fchief-ai%2Fblob%2Fmain%2F.env.example)

Bring-your-own-Supabase path: click the second button (clones this repo into
your GitHub and deploys to your Vercel), paste your existing project's URL +
anon key, and let the first-render setup screen finish the rest (it runs the
migrations for you when a `POSTGRES_URL` env var is present, otherwise it
tells you exactly what to paste into the SQL editor).

## Staying up to date

Chief ships updates as pull requests into **your own** repo: a weekly workflow
notices upstream has moved, opens a PR, and you review and merge it — merging
deploys the new version. Nothing changes without your approval, and Config →
**Software updates** shows when a new version is out and links straight to the
PR (and to the [changelog](/changelog)).

**Make your clone public** — it's the one thing that makes updates deploy on
Vercel's free (Hobby) plan. A private repo blocks the updater's merge commit
from deploying, because Hobby only deploys commits authored by a project
collaborator (which it doesn't support on private repos). Your clone is just a
copy of this public code and holds **no secrets** — `.env` is gitignored and
every credential lives in your Supabase, never in the repo — so public is safe,
and your data stays private regardless. During deploy, uncheck "Create private
Git Repository"; if you already deployed private, flip it under your repo's
Settings → Danger Zone → Change visibility → Public. (Prefer to stay private?
You'll need Vercel Pro, or to merge updates locally so the commit is authored by
you.) See `.github/workflows/upstream-updates.yml` and `TRUST.md`.

### Shipping a Chief release

`package.json` is Chief's single version source; the app, update check, and
GitHub release workflow all read it directly. Every Chief pull request must
increase that version with `npm run release:patch` (or `release:minor` /
`release:major`) and pass `npm run release:check`. Merging the version bump to
`main` creates the matching GitHub release automatically.

Do not copy the current version into helper docs. Instead, update the relevant
contract when behavior changes: `README.md` for user/setup instructions,
`TRUST.md` for security/privacy/data-flow changes, and `AGENTS.md` or
`CLAUDE.md` for coding-agent guidance. The PR template carries this review
checklist.

## Start here

1. **`BUILD-BRIEF.md`** — the master build brief: architecture, port map from `jim-homejab/Email-wrapper`, data model, security rules, and six build phases.
2. **`handoff/`** — design source of truth from Claude Design (`HANDOFF.md` = tokens + intent, `Chief Design Spec.dc.html` = visual spec).

## Getting started (local dev)

1. Create a Supabase project.
2. `cp .env.example .env.local` and fill in the Supabase URL + anon key —
   plus, to let the app do the rest itself, the service key and a
   `POSTGRES_URL_NON_POOLING` connection string (all on the project's
   connect/API pages).
3. `npm install && npm run dev` → open `http://localhost:3000`. First render
   walks you through it: one tap runs the migrations, then you create your one
   login in-app (there is no sign-up flow by design — that screen locks itself
   after the first user exists). Skipped the service key? The screen shows the
   manual fallback (SQL editor + dashboard Add-user) instead.
4. For Chief itself, set `ANTHROPIC_API_KEY` (or `AI_GATEWAY_API_KEY` /
   `vercel env pull` for gateway mode) — on a Vercel deployment neither is
   needed; the OIDC token covers it.

Build phases completed so far: **1** (skeleton, design system, PWA shell,
migrations, single-user auth) · **2** (core domain: projects with living
current-state records, tasks with waiting status, settings, journal, contacts,
communications log, knowledge base with hybrid search; Tasks & Projects
screens) · **3** (the Chief loop: streaming chat with the approve-first write
gate, resumable chat history and document review, contextual launch actions,
proposal cards with undo, MCP broker, journaled executor).

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
