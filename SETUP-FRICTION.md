# Setup friction log

Every step where a fresh user gets confused or has to do something manually,
logged as we go. **This file is the spec for the Phase 6 onboarding
concierge** — each entry is a candidate for automation or guided hand-holding.
Keep entries honest and specific; add new ones the moment friction appears,
including anything Jim hits deploying his own instance.

Format per entry: what you have to do → why it's friction → what the concierge
should do instead.

## The day-0 gap (design principle, not a step)

User #2 arrives at the GitHub repo with no Claude Code session and nobody
walking them through it. A README full of steps is not onboarding — nobody
reads past the first button. The rule that falls out:

> **Everything before the app's first render must collapse into a "Deploy to
> Vercel" button; everything after first render belongs to the in-app
> concierge. Nothing may live in between.**

Consequences for Phase 6:
- README's quick start becomes ONE deploy button (Vercel deploy-button flow
  clones the repo into the user's GitHub — no manual fork — prompts for env
  vars, and can create the Supabase project + inject keys via the
  Vercel×Supabase integration). That absorbs entries 1, 4, and 5 below.
- The concierge must be reachable **pre-auth**: on boot the app detects
  "setup incomplete" (missing env / empty schema / zero users) and renders
  the setup flow instead of a dead login screen. First render IS onboarding.
- Claude Code is the builder's tool; the concierge is the user's tool. The
  manual walkthrough below is the dry-run that writes the concierge's script.

### The refined funnel (v2 — Jim's corrections)

1. **Landing site** (static brochure, separate from the app): what Chief is +
   one Setup button + the API-key guide. It must stay static — the moment it
   collects keys or provisions on the user's behalf we've built a hosted
   service and broken the sovereign model. All automation lives in the
   button's parameters and in the user's own deployed app.
2. **The Setup button** is a parameterized Vercel deploy-button URL carrying
   the Supabase integration: one authorization creates the GitHub copy, the
   Vercel project, the Supabase project, and wires the env — automatically,
   all on the user's own accounts.
3. **First render = "paste your Anthropic API key."** The ONE dumb screen.
   Claude is not removed from onboarding — Claude IS the concierge; this
   screen is what unlocks it, so it comes first. Validate the key live with a
   cheap ping. Design warning: acquiring the key (console.anthropic.com,
   billing, credit card) is the most hostile step in the funnel and Claude
   can't help until the key exists — this screen must be the best-crafted
   static UI in the app: exact clicks, screenshots, "expect to add a payment
   method," instant paste-box validation.
4. **From screen 2 on, onboarding is a conversation.** Claude runs the
   migrations, creates the auth account, connects Gmail, scrapes the user's
   site, interviews for about-me/about-company — the setup endpoints ported
   in Phase 6 become its tools.

Net: exactly TWO manual human moments in the whole funnel — authorize the
deploy button, and fetch an API key. Everything else is automated or
Claude-guided.

## Phase 1 — Supabase + first sign-in

### 1. Create a Supabase project
- **Manual:** Sign up / sign in at supabase.com, create an org, create a
  project, pick a region, set (and immediately forget) a database password.
  On a paid org this is also a $10/month billing decision nobody warned you
  about.
- **Friction:** Four decisions (org, name, region, password) before anything
  visible happens. Region choice matters later (latency to Vercel) but nothing
  says so. The database password is never needed by Chief, yet it feels
  load-bearing.
- **Concierge:** A setup screen that says exactly what to click, states the
  cost up front, recommends the region nearest the user's Vercel deployment,
  and says "the database password won't be needed — store it and move on."

### 2. Apply the migrations
- **Manual:** Open the dashboard SQL editor and paste each file from
  `supabase/migrations/` in filename order (or install the Supabase CLI, log
  in, link the project, and run `supabase db push`).
- **Friction:** Copy-pasting SQL feels dangerous to a non-developer; the CLI
  path requires Node tooling knowledge and an access token. Neither tells you
  clearly whether it worked ("Success. No rows returned" is not reassuring).
- **Concierge:** A one-click "set up my database" step — the app runs its own
  migrations against the user's project (service-role key used once, here
  only, then discarded per the security rules) and verifies the schema before
  reporting success in plain language.

### 3. Create the single auth user
- **Manual:** Dashboard → Authentication → Users → "Add user" → email +
  password, and you must notice the **autoconfirm** toggle or the login just
  fails with "Email not confirmed."
- **Friction:** There is no sign-up flow in the app (by design), but nothing
  in the dashboard explains that. The autoconfirm trap is invisible until you
  hit the error.
- **Concierge:** First-run screen in the app itself: "Create your account" —
  the concierge creates the user via the admin API during setup, then never
  touches auth again.

### 4. Find and copy the API keys
- **Manual:** Project settings → API → copy the project URL and the anon key
  into `.env.local` (locally) and into Vercel project env vars (deployed).
- **Friction:** The API page shows several keys (anon, service_role, JWT
  secret) with scary warnings; picking the wrong one either breaks the app or
  leaks god-mode credentials. Doing it twice (local + Vercel) invites drift.
- **Concierge:** Paste-one-URL setup: user pastes the project URL, concierge
  tells them exactly which key to copy (with a screenshot-level description),
  validates it live before saving, and warns if a service-role key is pasted
  where the anon key belongs.

### 5. Deploy to Vercel
- **Manual:** Import the GitHub repo in Vercel, accept defaults, add the two
  `NEXT_PUBLIC_SUPABASE_*` env vars, deploy, then remember to redeploy after
  any env var change.
- **Friction:** Env vars added after the first deploy don't apply until a
  redeploy — the app just redirects to /login and fails silently with
  placeholder values. Nothing connects "blank screen" to "stale env."
- **Concierge:** A `/api/setup/health` style check the login page calls: if
  env vars are missing/placeholder, say so on-screen in plain language instead
  of failing mysteriously.

### 6. Install the PWA on the phone
- **Manual:** Open the deployed URL in Safari/Chrome on the phone → Share →
  "Add to Home Screen."
- **Friction:** iOS hides this three taps deep and never suggests it; users
  don't know a PWA is installable at all.
- **Concierge:** A one-time, dismissible install hint shown on first mobile
  visit, with per-platform instructions.

### 7. Nothing tells you what order to do things in
- **Manual:** Jim's first instinct was to preview the site before Supabase
  existed. Reasonable — but the app can't render past login without a
  database and a user, so the real order (Supabase → migrate → create user →
  deploy → open site) is invisible until someone tells you.
- **Friction:** The steps live in three different products (GitHub, Supabase,
  Vercel) and no one of them knows about the others. There is no progress
  indicator for "setting up Chief" as a whole.
- **Concierge:** The deploy-button + pre-auth setup flow makes ordering moot:
  deploy first is the only possible entry point, and the app sequences
  everything else itself with a visible checklist.

## Phase 2+ (add entries as they appear)

*(nothing yet)*
