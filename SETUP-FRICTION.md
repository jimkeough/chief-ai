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

### 1a. The sign-up/sign-in identity trap (hit live by Jim)
- **Manual:** Landed on the sign-*up* form, entered email + new password —
  but that email already had a Supabase account created via GitHub OAuth, so
  Supabase sent a "you already have an account" email instead of creating
  one. Had to back out and use "Continue with GitHub" instead.
- **Friction:** Nothing on the sign-up form checks "does this email already
  exist?" until after you've invented and typed a password. And once in, the
  dashboard shows whatever orgs that identity is a *member* of (a work org,
  here), which reads as "my personal stuff lives inside my company's
  account" — identity vs. org is invisible.
- **Concierge:** The guide should say up front: "If you've EVER used GitHub
  to sign in to Supabase, use Continue with GitHub — don't create a new
  account." And explain the model in one line: *your login is an identity;
  orgs are containers it can see — Chief gets its own free org, separate
  from any work orgs you belong to.*

### 1b. Helper tools can't reach the sovereign org (by design)
- **Observed:** Claude's Supabase MCP connection (authorized by the work
  account) cannot see the personal "Jim AI" org — so it couldn't run the
  migration on the user's behalf, even mid-conversation.
- **Insight, not a bug:** no outside assistant's credentials can touch the
  user's sovereign instance. This is exactly why onboarding automation must
  run AS the user — via the deploy button (their OAuth grants) and the in-app
  concierge (their API key, their session) — never as a helper with its own
  access. The concierge design is validated by its absence here.

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

## Design decisions from the walkthrough (feed Phase 6)

### Auth screen must be swappable — watch "Sign in with Claude"
Anthropic runs an OAuth program where users of approved apps (Cursor, Xcode…)
authenticate with their claude.ai account and usage draws from their
subscription credits. It is currently a curated partner program (not
self-serve) and its policy shifted repeatedly through 2026 (ban → reinstate →
per-user credit pools), so Chief cannot build on it yet. Design consequence:
the API-key screen is ONE screen behind ONE auth abstraction, so if/when
Sign-in-with-Claude opens to all developers it becomes a button swap. Until
then: deep-link to the console key page, warn that billing setup is required,
validate the key instantly on paste.

### Updates ship as proposals
Deploy-button users have a disconnected copy of the repo — updates don't flow.
Mechanism: the template ships a GitHub Action that checks upstream releases
and opens a PR in the user's own repo; merging auto-deploys via Vercel. Chief
surfaces it as a proposal card ("An update to me is available — approve to
merge") — the trust contract applied to the app's own evolution. Commitments
this makes now: tag versioned releases from day one; migrations stay
forward-only; the app runs pending migrations on boot.

### Trust architecture (why a stranger should run this)
Layered, most-verifiable first:
1. **Structural guarantees** — outbound network allowlist in code (the app can
   only talk to the user's Supabase, Anthropic, and Gmail; no phone-home is a
   property, not a promise); keys never leave the user's infra; nothing sends
   without an approved proposal; append-only journal.
2. **Byte-diffability** — the user's clone vs. the public repo is one GitHub
   compare link; nothing can be slipped into their copy silently.
3. **Independent AI audit** — onboarding hands the user a canned prompt:
   "paste this repo into any AI you trust, OUTSIDE this app, and ask it to
   look for backdoors or data exfiltration." Independent because that model
   isn't controlled by the app. The in-app Claude audit (live RLS-policy
   check, env hygiene) is a convenience layer only — an audit run by the
   thing being audited can never be the trust anchor.
4. Credibility furniture: SECURITY.md, pinned lockfile, public CodeQL +
   secret scanning.

## Walkthrough #1 result (2026-07-05)

Jim completed the full manual path on a phone — Supabase org + project +
migration + auth user, keys to Vercel, deploy, sign-in — in roughly an hour
of elapsed time WITH an expert guide answering every question in real time.
That guide is exactly what user #2 won't have; the funnel (deploy button →
API key → concierge) replaces it. Detailed debrief deferred by decision:
**Test #2 is the one that matters** — Jim re-runs as user #2 through the
deploy-button funnel once the landing site exists (provisioning pass), and
again after Phase 6 (full concierge pass). Entries above were logged live
and stand as the spec.

## Phase 2+ (add entries as they appear)

### 8. Phase 3 flips ANTHROPIC_API_KEY from optional to required (2026-07-05)
The Chief loop ships and the app's core is now Claude — but walkthrough #1
only put the Supabase keys into Vercel. Manual step for Jim (and every
pre-funnel user): create a key at console.anthropic.com → Vercel project →
Settings → Environment Variables → add `ANTHROPIC_API_KEY` → redeploy.
Optionally `VOYAGE_API_KEY` for semantic memory search (the app degrades to
full-text without it).
**Funnel note:** this is THE moment the day-0 concierge is designed around —
the API-key screen must catch a missing/invalid key at runtime with a
friendly in-app screen ("paste your key here" → stored where? Vercel env
needs a redeploy, so v1 funnel likely wants the key entered in-app and held
in the DB instead of env — decide in Phase 6). Until then it's a raw Vercel
env-var errand.

### 9. Connecting Gmail is the heaviest errand yet (2026-07-05, Phase 4)
The inbox uses Google's OFFICIAL Gmail remote MCP server
(gmailmcp.googleapis.com) — the sovereign trade is that each user brings
their own Google Cloud OAuth client. Manual steps: create a GCloud project →
enable the Gmail API **and** the Gmail MCP API → configure the OAuth consent
screen (Branding → Audience → add yourself as a test user if External) →
Data Access → add scopes gmail.modify + gmail.compose + gmail.send → create
a Web-application OAuth client with redirect URI
`https://<your-app>/api/google/callback` → paste client ID/secret into
Vercel env (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) → redeploy → tap
**Connect Gmail** on the Inbox screen and approve.
That's ~6 console screens of pure friction, worse than Supabase. It's also
inherently un-collapsible into the Deploy button (Google requires the user's
own consent screen for these scopes). **Funnel note:** this is the
concierge's second big set piece — Chief should walk the user through the
GCloud console step by step with deep links, then verify the connection
itself. Also: Google marks unverified external apps with a scare screen
("Google hasn't verified this app") — the concierge must warn the user it's
THEIR OWN app so the screen is expected.
**Design note:** the official server has NO send tool (drafts only). Jim
chose real send, so the app's one send path is a direct Gmail REST call in
the executor behind the slide-to-send card — the gmail.send scope exists for
exactly one function call.

### 9a. "There must be an easier way" — the Gmail-connect trade space (Jim, 2026-07-05)
Why it's hard: gmail.modify/send are Google RESTRICTED scopes. A shared
OAuth client (the 2-click SaaS experience) requires Google's restricted-scope
verification + annual CASA security assessment — real money, months, and a
central chokepoint. Per-user clients (current design) skip all of that
because each user is the "developer" of their own app. The friction IS the
price of sovereignty.
Options, in order of fit:
1. **Concierge-guided per-user client (v1 decision).** Phase 6 Chief walks
   the user through the console with deep links, then verifies the
   connection itself and pre-warns about the "Google hasn't verified this
   app" screen. Same steps, near-zero confusion, sovereignty intact.
2. **Shared verified client + tiny auth broker (the scale move).** True
   2-click connect; costs Google verification/CASA and a small hosted
   service that momentarily touches tokens before handing them to the
   user's own instance. Revisit when user count justifies it.
3. **Managed OAuth vendor (Pipedream/Nango).** Fastest, but a third party
   sits in the token path — weakest fit for the trust story.
4. **App password over IMAP/SMTP (SHIPPED as the default, via Claude Chat's
   suggestion).** One-string setup: 2FA on → generate app password → paste.
   Full-mailbox credential (the honest trade, stated in the UI), revocable at
   the provider, stored only in the user's own DB — and it makes Chief
   provider-agnostic (Outlook/Fastmail/iCloud via the advanced host fields).
   OAuth stays as the scoped path. The GCloud errand (entry 9) is now
   OPTIONAL, which shrinks the concierge's hardest set piece to a nice-to-have.

### 10. THE STRATEGY DECISION: hybrid — sovereign core, brokered edges (Jim, 2026-07-06)
Jim chose the middle ground between full sovereignty and full SaaS:
- **Infra stays sovereign and collapses to one click**: the README Deploy
  button now bundles the Supabase Vercel-Marketplace product — clone repo →
  Vercel project → Supabase auto-provisioned on the user's account with
  migrations run and env vars injected → one prompt for the Anthropic key.
  Remaining manual steps: create the login user (Supabase → Auth → Add user)
  and connect email (paste an app password). That's the whole funnel.
- **Connectors get an optional PAID hub — "Chief Connect"**: an operator-run
  token service (connect-service/, standalone deploy) holding the Pipedream
  Connect credentials; user deployments hold only a subscription key. 2-click
  OAuth for Gmail/Calendar/Notion/etc. through Pipedream's verified clients
  (~$150/mo for 100 users, ~$2/user after → a ~$5/mo subscription covers it).
- **Trust ledger formalized in TRUST.md**: what the hub can see (connected-app
  list + Pipedream-managed tokens), what it never sees (DB, keys, mail,
  approvals), and the eject path (every connector has a sovereign twin;
  blanking two settings removes the layer).
- MVP security note: Pipedream access tokens are project-scoped; isolation
  rests on unguessable per-customer externalUserIds. Hardening path: proxy
  MCP calls through the service. Documented in connect-service/README.

### 11. The login-first pivot: should a hosted concierge run day-0? (Jim, 2026-07-07 — REJECTED, staying with the v2 static-landing funnel)

The question (Jim): require users to log into OUR app first, and have it
concierge them through spinning up their sovereign instance — instead of the
static landing site + deploy button of the v2 funnel.

**What it would genuinely fix.** The v2 funnel's known weak point is that
Claude cannot help until the Anthropic key exists (funnel step 3, entry 8) —
the most hostile step in the whole flow is covered only by "the best-crafted
static UI in the app." A hosted concierge runs on the OPERATOR's key, so it
is present for both manual human moments (deploy-button authorization AND
key acquisition). Two further wins come free: **resumability** (today a user
who abandons mid-setup is simply lost; an account lets them pick up where
they left off, and gives the operator a follow-up channel) and **Chief
Connect finally gets a front door** — today issuing a subscription key means
hand-editing the `CONNECT_KEYS` env var (connect-service/README), which does
not survive contact with customer #10. The account created at onboarding is
the natural place for the Connect subscription and billing to live later.

**The line it must not cross.** The v2 rule exists for a reason: "the moment
it collects keys or provisions on the user's behalf we've built a hosted
service and broken the sovereign model." Entry 1b already proved the deeper
point structurally — no helper's credentials can touch the user's sovereign
instance, and that's a feature. So a hosted concierge's verbs are limited by
design to: **explain, deep-link, verify, hand off.** It never holds the
user's Anthropic key, never takes a GitHub/Vercel/Supabase OAuth grant, never
provisions. The deploy button (the user's own grants) remains the only actor.
Verification is done from the outside: poll the user's chosen deployment URL
for `/api/setup/health` (entry 5's endpoint, now doing double duty) to watch
the checklist tick over, and hand off to the IN-APP concierge at first
render. Phase 6 is unchanged — the hosted concierge covers pre-render, the
in-app concierge covers post-render; the seam between them is first render,
same as the v2 rule always said.

**Options, in order of fit:**
1. **Guide-only hosted concierge (recommended shape if we pivot).** Email
   magic-link login (an email is a far cheaper ask than an API key — the wall
   is low). A stateful checklist wizard whose steps are the v2 funnel's
   script; mostly deterministic UI with Claude chat as the escalation hatch,
   on the operator's key, per-account token caps. Polls the user's app URL to
   verify progress. Later becomes the Chief Connect account/billing portal.
2. **Status quo (static landing).** Zero operator cost, zero new trust
   surface, but the API-key cliff stays unattended and abandonment is
   unrecoverable.
3. **Full hosted portal** — collects the Anthropic key, takes OAuth grants,
   provisions for the user. Genuinely 2-click, and genuinely a hosted SaaS
   holding god-mode credentials: breaks TRUST.md's core accounting. Rejected;
   if we ever want this we should admit we're building a hosted product and
   redesign the trust story from scratch, not erode it.

**The honest costs of option 1:** a login wall in front of a funnel already
fighting drop-off (mitigated by magic-link, and by letting the brochure page
remain readable pre-login); operator pays Anthropic tokens for prospects who
may never convert (mitigated: deterministic wizard first, AI on demand,
caps); a second surface to build and keep in sync with the funnel script;
and one more paragraph owed to TRUST.md ("what the onboarding service can
see: your email address and your setup progress; what it can never see:
everything else").

**If adopted, the v2 rule amends from** "the landing site must stay static"
**to** "the landing service may talk and verify, but may never hold a
credential or provision on the user's behalf." The two-manual-moments
invariant is unchanged — they just stop being unattended.

**Decision (Jim, 2026-07-07): rejected.** Staying on the v2 funnel — static
landing site + deploy button, concierge starts at first render. The v2 rule
stands unamended.

### 12. The v2 funnel, implemented: one zero-question link (2026-07-07)

The landing-site link now exists and prompts for NOTHING — the README's
primary Deploy button (repo clone + Vercel project + Supabase via the
`stores` Marketplace parameter, no env prompts). What made zero-question
possible, and what to verify at dogfood #2:

- **AI Gateway is now the DEFAULT provider** (`ai.provider` default =
  `gateway`). The funnel's most hostile step — console.anthropic.com, billing,
  card — is gone: the deployment's OIDC token authenticates and usage bills to
  the user's own Vercel account. Direct-Anthropic stays one setting away, and
  gateway mode with no credential falls back to a present `ANTHROPIC_API_KEY`
  (so local dev and old-style deployments keep working unchanged). Connectors
  are unaffected — the app brokers MCP itself; only the optional server-side
  web fetch is Anthropic-native (TRUST.md caveat updated).
- **The Marketplace injects NEW env-var names** (publishable/secret keys, not
  anon/service_role: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SECRET_KEY`, `POSTGRES_URL*`). The app now reads either naming
  (`lib/supabase/env.ts`) — without that, a one-click instance boots with env
  present but unread, the exact silent failure of entry 5.
- **Migrations do NOT run themselves** — entry 10 / PR #9 overclaimed that.
  Instead the app now runs its own migrations: first render (or `POST
  /api/setup/migrate`) applies `supabase/migrations/*.sql` over the injected
  `POSTGRES_URL_NON_POOLING`, recorded in the same ledger the Supabase CLI
  uses. This also discharges the "app runs pending migrations" update
  commitment.
- **First render IS onboarding, for real now**: `/login` consults
  `GET /api/setup/health` (entry 5's endpoint) and renders the right moment —
  env-not-wired explainer / one-tap database setup / **create-your-login
  in-app** (admin API, autoconfirm handled; entry 3 absorbed) / sign-in.
  Every setup mutation refuses to run once the first user exists.
- **The honest trade to state on the landing page**: until the first login is
  created, a fresh deployment is claimable by whoever reaches its URL — the
  price of a zero-prompt deploy. Deploy → open your URL → create your login,
  in one sitting.
- **Verify at dogfood #2** (things only a live click can prove): the `stores`
  parameter is what current Vercel docs specify (the older `products` spelling
  is what PR #9 shipped; if the Supabase card doesn't appear on the clone
  screen, try `products`); whether the Marketplace flow demands a credit card;
  whether `VERCEL_OIDC_TOKEN` is present without toggling project settings
  (Settings → Security → Secure backend access); and gateway billing appearing
  on the Vercel invoice.

Remaining manual moments in the funnel: authorize the deploy button, create
your login at first render, paste an email app password. The Anthropic-key
moment is gone.

## Dogfood #2 — teardown of walkthrough #1 (the reset checklist)

To re-run onboarding as a true user #2, delete everything walkthrough #1
created, in this order (helper sessions can't do this for you — entry 1b's
lesson: only your own logins can touch sovereign infra):

1. **Supabase**: dashboard → the Chief project (personal org, e.g. "Jim AI")
   → Project Settings → General → Delete project. (Deleting the project
   deletes the auth user and all data with it — nothing else to clean.)
2. **Vercel**: dashboard (personal scope) → the chief project → Settings →
   Advanced → Delete Project. If Chief Connect's `connect-service` is deployed
   as its own project, LEAVE it — it's operator infrastructure, not user
   infrastructure.
3. **GitHub**: delete the cloned repo if walkthrough #1 created one (Settings
   → Danger Zone). If the Vercel project was imported straight from
   `jim-homejab/ai-cockpit`, there is no clone to delete — and dogfood #2
   SHOULD produce one, since the deploy button clones.
4. Optional, for the full user-#2 experience: use a fresh Vercel account (new
   email) so the signup wall, GitHub authorization, and Marketplace billing
   prompts all appear exactly as a stranger would see them.

Then: click the README's primary Deploy button on a phone, and log every
friction moment here as entries 13+.
