# Setup friction log

Every step where a fresh user gets confused or has to do something manually,
logged as we go. **This file is the spec for the Phase 6 onboarding
concierge** — each entry is a candidate for automation or guided hand-holding.
Keep entries honest and specific; add new ones the moment friction appears,
including anything Jim hits deploying his own instance.

Format per entry: what you have to do → why it's friction → what the concierge
should do instead.

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

## Phase 2+ (add entries as they appear)

*(nothing yet)*
