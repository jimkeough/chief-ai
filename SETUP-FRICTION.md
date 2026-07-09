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

## Walkthrough #2 result (2026-07-08) — the provisioning pass, live

Jim ran the deploy-button funnel end to end on a phone. The zero-question
provisioning half **works**; the after-deploy half surfaced four real bugs
(all fixed this session) and one broken subsystem (updates), rebuilt. Log:

### 13. Signup wall — "Sign up" vs the provider buttons; phone verification
- The Vercel "New Project" screen shows a **Sign Up** button, but the three
  provider buttons (GitHub/GitLab/Bitbucket) ARE the signup — clicking
  **Continue with GitHub** collapses Vercel signup + GitHub authorization into
  one action. The separate "Sign Up" reads as a required extra step.
  → Landing-site copy: "You'll sign in with GitHub — that covers both accounts."
- **Vercel ties one phone number to one account**, so an operator testing with
  themselves can't make a true second account. NOT a real-user blocker (a
  stranger has their own phone); it just means the provisioning pass runs on
  the operator's existing Vercel account. Fresh-identity testing needs a burner
  number.

### 14. The upstream repo must be PUBLIC (launch blocker)
The deploy button clones the source repo; if `jim-homejab/ai-cockpit` is
private, a stranger's Vercel can't read it and the button fails. Made public
(the byte-diffability trust story assumes public anyway). Pre-launch checklist
item. (History was scanned clean first — only `.env.example` ever committed.)

### 15. Provisioning half works — confirmations
- The `stores=[{…supabase…}]` deploy-button parameter **is** correct (Supabase
  card appears on the clone screen; the older `products` spelling was wrong).
- Supabase provisions on the **Free plan, no credit card**.
- The Marketplace injects **both** env-var naming schemes (anon/service_role
  AND publishable/secret + POSTGRES_URL*); the app reads either
  (`lib/supabase/env.ts`).
- The user's clone repo is named from `repository-name` (`chief`), private by
  default; the clone screen still shows the upstream name as the source.

### 16. First render skipped DB setup on an empty database (fixed, PR #23)
Health check reported `schema: "ready"` on a freshly provisioned, EMPTY DB
(PostgREST's schema cache returned no error for the missing table), so the app
jumped past "Set up my database" straight to "Create your login" — which would
have created a login on a schema-less instance. Fixed: detect schema
authoritatively over the direct Postgres connection (`to_regclass`), route to
setup unless schema is *confirmed* ready, and a create-user guard.

### 17. In-app migrations failed TLS to Supabase (fixed, PR #24)
"Set up my database" hit **"self-signed certificate in certificate chain."**
`ssl:{rejectUnauthorized:false}` alone wasn't enough — node-postgres treats a
`sslmode=require` in the injected `POSTGRES_URL` as `verify-full`, overriding
it. Fixed by stripping `sslmode` from the URL. (Only caught because the earlier
local test used a non-TLS database; verified the fix against a self-signed TLS
Postgres.)

### 18. AI Gateway zero-key auth failed at runtime (fixed, PR #26)
With gateway as the default and no keys, Chief said "No AI provider is
configured." Cause: `VERCEL_OIDC_TOKEN` is an env var only at BUILD time; at
RUNTIME it arrives as a request header and must be read via
`getVercelOidcToken()`. "Secure Backend Access (OIDC Federation)" was already
enabled by default (Team issuer) and the token was minting — the bug was purely
reading it from the wrong place. Fixed.

### 19. THE update pipeline was broken end to end (rebuilt, PRs #25/#27 + this)
The "updates ship as proposals" design assumed clones are git forks. Vercel
deploy-button clones are **not forks and not git clones** — they're a fresh
repo seeded with the template files. Consequences, each a separate break:
- **`.github/workflows/` is stripped** on clone (Vercel's App lacks the
  `workflow` scope), so the updater never lands in a user's repo → PR #25 ships
  the workflow as a string and adds a one-tap "Enable auto-updates" that commits
  it into the user's own repo (deep link built from `VERCEL_GIT_REPO_*`).
- **Enabling also needs** "Allow GitHub Actions to create pull requests" toggled
  on (off by default) — currently a documented step in the card.
- **Unrelated git history** → the updater's `git merge upstream/main` refused
  ("unrelated histories") and its `git merge --abort` fallback then failed too
  (exit 128) → PR #27: `--allow-unrelated-histories -X theirs` + a safe abort.
  First update reconciles history; later ones are ordinary merges.
- **Detection can't use commit SHAs** (unrelated histories never match) and the
  app can't read the private clone via API → this PR makes detection
  **version/release-driven**: the operator tags releases (`release.yml` cuts a
  GitHub Release on a `package.json` version bump), and the app compares its
  bundled version to upstream's latest PUBLIC release (`/api/updates/status`),
  surfacing an "update available" card in Config → Software updates.

**Final update process (design):** first update = one tap in-app to commit the
workflow (+ the PR-permission toggle) — ideally folded into onboarding; every
update after = the weekly workflow opens a PR and Chief shows an approve-first
"vX available → review & merge" card. All in the user's own repo + Vercel; no
operator in the path. Scale option (later): a "Chief Updater" GitHub App that
opens the PRs centrally, removing the per-repo workflow + toggle.

### 20. Integrations — keep the bundle minimal (decision)
The deploy button bundles Supabase only, on purpose. Add capability through
NATIVE Vercel features (Cron for a daily digest / update check) and what
Supabase already provides (Storage for files) — not more Marketplace products.
**Never** add telemetry/analytics/error-reporting integrations (Sentry, Vercel
Analytics, Log Drains): they ship user data off the instance and break
TRUST.md's no-phone-home guarantee.

### 21. Cosmetic: "A Node.js API is used (process.version)" build warning
`@supabase/ssr` → `@supabase/supabase-js` references `process.version`, which
Next flags for the Edge middleware runtime. Build still "Compiled
successfully"; harmless. Optional cleanup: pin middleware to the Node runtime.

### 22. AI Gateway zero-key ≠ zero-cost — the real payment step (2026-07-08)
Chief responded once the gateway was sorted, but the path revealed the true
cost gate (two 403s, in order):
1. **Before a card:** `customer_verification_required` — "AI Gateway requires a
   valid credit card on file to service requests." Account-level, model-
   independent: **no card = no gateway at all**, even for free credits.
2. **Card added, on Opus:** `RestrictedModelsError` — "Free tier users do not
   have access to this model." Premium models need **paid credits** (Jim hit a
   **$10 minimum top-up**); free-tier models run at $0 on just a card.

So the "API-key cliff" (entry 8) didn't disappear — it **moved to Vercel**: a
card is required regardless of model; premium models cost real money. The win
is one account (Vercel, already made for the deploy) instead of two, and a
$0 path exists via free-tier models. Honest framing now in README/TRUST:
**zero-key, not zero-cost.**

Responses shipped this session:
- **Free-model fallback** (`lib/ai.ts`): gateway calls carry
  `providerOptions.gateway.models:[<free model>]`, so a premium model the
  account can't reach degrades to a working free one instead of erroring.
- **BYOK** (`ai.byok_anthropic_key` setting): paste your own Anthropic key →
  premium models run on your Anthropic billing through the gateway, no Vercel
  top-up. (Open question to verify: whether BYOK also waives the card-on-file
  requirement.)
- **Default-model decision (pending Jim's live test):** keep Opus (premium,
  needs credits/BYOK — best tool-use) vs. default to a free agentic model
  (`moonshotai/kimi-k2.7`, $0 first-run) — decided by testing whether a free
  model handles Chief's approval-card/tool protocol acceptably.

Still owed (next): per-turn cost display + a Config → Usage panel (token usage
per response; `/v1/credits` for balance + lifetime spend; spend reports tagged
via `providerOptions.gateway.tags`).

## Walkthrough #2 — bottom line
The zero-question provisioning funnel (deploy button → Supabase → first-render
DB setup → in-app login) is **proven end to end on a real deployment**, and
Chief runs on the sovereign zero-key gateway default. Remaining friction is
honest and small: sign in with GitHub (covers both accounts), a payment method
on Vercel (one account, $0 on free models), and the update-enable tap. Every
bug the walkthrough surfaced (entries 16–19) is fixed.

## Walkthrough #2, continued (2026-07-08) — the update path is architecturally broken

Jim tried to actually PULL an update on his live instance (`jimkeough/chief`,
Vercel Hobby, private repo). Chasing it down took four failed runs and three
code fixes, and it ended at a wall that **cannot be fixed in this repo** — the
whole "updates as PRs into the user's own repo, merge auto-deploys" model
collides with a Vercel Hobby-plan restriction. A new session picking this up
should read entry 19 first (the pipeline's earlier rebuild), then this.

### 23. The update pipeline dies at the Vercel deploy step (BLOCKER — needs an architecture decision)

The chain of failures, in the order we hit them (each real, each was a
separate fix or dead end):

1. **`workflows` permission push-reject (fixed, PR #35).** The updater's
   `git merge upstream/main` pulls in changes under `.github/workflows/`
   (e.g. `release.yml`). The default `GITHUB_TOKEN` can **never** create or
   update files under `.github/workflows/` — a hard, unconfigurable GitHub
   rule (stops a workflow from rewriting workflows to self-escalate). The push
   is rejected outright.
   - A mid-fix (PR #34) wrongly added `permissions: workflows: write` to the
     YAML — **there is no such permission key**; valid scopes are `contents`,
     `pull-requests`, `issues`, `actions`, etc. A user who hand-copied it got
     `Invalid workflow file … Unexpected value 'workflows'` ("Startup
     failure"). Reverted.
   - **Real fix (PR #35):** a "Strip workflow-file changes" step reverts any
     `.github/workflows/**` change out of the merge commit before pushing, so
     the branch never touches that path. `upstream-updates.yml` itself is kept
     current through the *separate* "Enable auto-updates / re-commit" link
     (that push is the user's own, not the Actions bot's, so it's allowed).
2. **`gh pr create` → `Resource not accessible by integration`.** Even with
   the branch pushed, opening the PR from Actions requires the repo toggle
   "Allow GitHub Actions to create and approve pull requests" (Settings →
   Actions → General). It has TWO separate Save buttons on that page; easy to
   check the box and save the wrong section. Workaround that unblocked Jim:
   GitHub prints a `…/pull/new/chief/upstream-update` link in the push output
   — he opened the PR himself (a human-created PR isn't subject to the Actions
   restriction).
3. **THE WALL — Vercel blocks the deploy on commit author (NOT fixable here).**
   The PR merged cleanly (no conflicts). But both the PR preview check and the
   post-merge production deploy were **blocked by Vercel**:
   > "The deployment was blocked because the commit author did not have
   > contributing access to the project on Vercel. The Hobby Plan does not
   > support collaboration for private repositories."
   The blocking author is **`web-flow`** — GitHub's system identity for
   anything committed through its web UI, which includes **merge commits made
   by clicking GitHub's "Merge pull request" button**, plus the older
   squash-merge commits already in upstream's history that got dragged in by
   the first catch-up merge (68 commits).
   - Mechanism: on **Vercel Hobby + a PRIVATE repo**, a deployment is refused
     unless the triggering commit's author is a project collaborator — and
     Hobby doesn't support collaborators at all. So *any* commit not authored
     by the account owner's own verified git identity is un-deployable. Bot
     commits and GitHub-web-UI merges are all `web-flow`. → the update path's
     final step (merge → auto-deploy) is dead on the default plan.

**Why this is architectural, not a bug.** The update design (entry 19, and
the "Updates ship as proposals" decision above) rests on: *upstream change →
PR into the user's private repo → user merges → Vercel auto-deploys.* Step 4
requires Vercel to deploy a commit that, by construction, is authored by a bot
or by GitHub's web-flow merge identity — exactly what Hobby+private forbids.
No workflow-file or permission change can move this; it's a plan property.

**The escape hatches that exist today (all imperfect):**
- **Manual redeploy from the Vercel dashboard.** The owner clicking "Redeploy"
  is an owner-initiated action, not a git-author-gated push, so it builds.
  Unblocks a single update; not an "easy, obvious" update path.
- **Upgrade to Vercel Pro.** Removes the collaboration restriction entirely.
  Costs money; pushes a plan requirement onto every self-hoster.
- **Merge locally, not via GitHub's web button.** `git pull && git merge &&
  git push` re-authors the tip commit as the user's own verified identity,
  which Vercel accepts. Defeats the "review-and-merge in the GitHub UI" UX and
  assumes a git-capable user.
- **Make the repo public.** Sidesteps the private-repo collaboration gate, but
  contradicts the current default (clones are private by default; only the
  UPSTREAM template is public — entry 14).

**Option space for the redesign (for the next session / colleague discussion,
not yet decided):**
- **A. Require/recommend Vercel Pro** for self-hosters who want one-click
  updates. Simplest, but a paywall on the core "keep your instance current"
  promise.
- **B. In-app update service** (Jim's sketch): Chief shows "vX available →
  [Create pull request]", and the app/a small service opens the PR. Does **not**
  solve this — the resulting merge commit is still bot/web-flow authored, so
  Vercel still blocks the deploy on Hobby+private. And a service that pushes to
  the user's repo needs a stored credential, cutting against TRUST.md's "only
  you ever touch your repo." Rejected on those two grounds unless paired with
  something that fixes the author gate.
- **C. Deploy from a source that isn't git-author-gated.** E.g. Chief triggers
  its own Vercel deploy via a deploy hook / the Vercel API after the user
  approves — decoupling "get the new code into the repo" from "deploy," so the
  deploy is owner-initiated (like the manual Redeploy) rather than commit-author
  gated. Needs a Vercel token in the instance (TRUST.md implications, but it's
  the user's OWN token for their OWN project — arguably in-bounds, unlike B).
- **D. Rethink distribution entirely** — treat upstream as a versioned
  template/release artifact the instance pulls and applies, rather than a git
  ancestor merged via PR (this was floated as "Option 3/4" in the chat). Bigger
  lift; may or may not dodge the Vercel author gate depending on how the deploy
  is triggered.

**State of the code right now:** `main` has the *correct* PR-#35 version of
`upstream-updates.yml` (strips workflow files; no invalid `workflows:` key).
The pipeline now successfully: detects behind-ness, builds the branch, strips
workflow files, pushes, and (with the toggle on, or via the printed link)
opens a PR. It gets all the way to a clean, mergeable PR — and then the deploy
is what's blocked. So the fix surface has moved entirely to "how does the new
code get DEPLOYED," which is options A–D above. Jim's instance is mid-update:
PR #1 in `jimkeough/chief` is merged but the production deploy is blocked;
immediate unblock is a manual Redeploy from the Vercel dashboard.

**Note for whoever picks this up:** the in-repo Software-updates UI still tells
the user the old story (enable → run workflow → merge → done). Until the deploy
gate is solved, that UI is promising an update flow that stops one step short.
Don't ship UI copy claiming updates "just work" until option A–D is chosen.

### 24. RESOLVED — the deploy gate falls to a public clone (2026-07-08)

Entry 23's wall is gone. The fix is the simplest thing on the option list and
wasn't options A–D: **make the user's clone public.**

**Why it works.** The block is Vercel's, and it is scoped to *private* repos:
"the Hobby Plan does not support collaboration for **private** repositories."
Public repos on Hobby deploy commits from **any** author — the ordinary
open-source flow — so the updater's `web-flow`/bot merge commits deploy with no
Pro, no token, no re-authoring. Proven live on `jimkeough/chief`: after flipping
to public, every commit on `main` builds green and the instance moved to v0.3.0.
(Redeploy stays blocked because it rebuilds the *same* old `web-flow` commit
under Vercel's cached private-repo state; the unstick is a *fresh* commit —
Jim's own README edit — after which the normal merge→auto-deploy flow resumes.)

**Why it's safe / doesn't break sovereignty.** A Chief clone holds no secrets:
`.env*` is gitignored (only `.env.example`, a placeholder, is tracked), and
every credential lives in the user's Supabase. The clone is a byte-for-byte copy
of the already-public upstream. So public exposes nothing new; the **data plane
stays private in Supabase** regardless. It also makes TRUST.md's "diff your
clone vs. upstream" trivially easy.

**What shipped this session (all sovereign — no operator, no stored token):**
- **Public-by-default guidance + a detection safety net.** `getRepoPublic()`
  (`lib/updater-workflow.ts`) reads the deployment's own repo via the *public*
  GitHub API with no token (200 → public, 404 → private, else → unknown);
  `/api/updates/status` returns `repoPublic`. Config → Software updates shows a
  "Make your repo public to receive updates" card (with the no-secrets rationale
  + a link to repo Settings) *only* when the repo is positively detected
  private. Nobody hits the wall blind again.
- **Rewrote the Software-updates card.** Removed the "GitHub blocks the updater"
  doom framing. It's now a launch pad: version status → **Review & merge** deep
  link to the PR (with a "Prepare it" link to `workflow_dispatch` when no PR
  exists yet) → merge deploys. Honest one-time-setup copy for enabling the
  workflow. Fixes the entry-23 "don't ship 'just works' copy" note.
- **Public `/changelog` page** (`app/changelog/page.tsx`, allowed pre-auth in
  middleware): renders upstream's public releases as human-readable notes — the
  informational companion the in-app card links to. (Distinct from installing:
  a *marketing/changelog* page is anonymous and can't know a visitor's repo, so
  the actionable "get this into YOUR repo" button must live in the app, which
  knows the repo from `VERCEL_GIT_REPO_*`. The changelog is release notes, not
  an installer.)
- **Docs**: README "Staying up to date" + TRUST.md "Updates (sovereign)"
  section now state the public-clone requirement and why it's safe.

**Known remaining friction (documented, not blocking):**
- **Deploy button can't force public.** Vercel's deploy-button URL has no
  visibility parameter (verified against Vercel docs — supported params are
  `repository-url`, `repository-name`, `env`, `stores`, `integration-ids`,
  `redirect-url`, …). The clone screen defaults to a *private* repo via a
  checkbox the user must uncheck. So "make it public" is one guided step, not
  automatic. Onboarding/concierge candidate.
- **GitHub auto-pauses scheduled workflows after 60 days of repo inactivity.**
  A quiet user's weekly updater cron silently stops opening PRs. Mitigated:
  detection is app-driven (the version check doesn't need the cron), and the
  card links to run the workflow manually. Worth a concierge nudge if a check
  hasn't run in a while.
- **Private-repo path still exists for holdouts:** Vercel Pro, or merge updates
  locally (`git pull && git push`) so the tip commit is authored by the owner.
  Documented as the advanced/opt-out path; public is the recommended default.

### 25. Public-clone fix PROVEN live, and the PR-auto-open step is unreliable (2026-07-08, v0.4.1)

Ran the whole loop on Jim's real free-tier instance (`jimkeough/chief`, Hobby):
made the repo public → detected "Update available — v0.4.0" → ran the updater →
merged → **production deployed green** ("Chief/upstream update (#2)" → Ready on
`main`). Entry 24's fix holds end to end: **a normal user on the free plan can
now stay current.** No Pro, no token, no operator.

**New finding — the auto-open-PR step can't be relied on.** Jim's `gh pr create`
step failed *even though* "Allow GitHub Actions to create and approve pull
requests" was already checked (screenshot-confirmed). The workflow's canned
error blames that toggle, but it was on — so the real cause is something else
(GitHub's Actions PR gate misfires; exact reason not diagnosable from the app,
and the app can't read the private run logs anyway). Chasing the root cause is a
dead end; the fix is to **not depend on the Action opening the PR.**

The reliable half of the job is **pushing `chief/upstream-update`** — that
always works. Opening the PR is the flaky part, and a PR the *user* opens is
never gated (Jim confirmed this by hand: creating the PR from the compare page
worked instantly). So v0.4.1:
- **Workflow (`upstream-updates.yml` + embedded `UPDATER_WORKFLOW_YAML`)**:
  `gh pr create` is now **best-effort** — on failure it emits a `::warning::`
  (pointing at Chief's Review & merge link) instead of `exit 1`, so the run
  stays green after the push. The push itself stays fatal (it's what we need).
- **App**: the "Review & merge" button now targets a **compare/create-PR deep
  link** (`getUpdatesInfo().createPrUrl` → `…/compare/main...chief/upstream-update?expand=1`)
  rather than `/pulls`. That page shows the diff and a Create-PR button (or the
  existing PR) — so it works whether or not the Action managed to open one. A
  "Prepare it first" link (run the workflow) covers the case where the branch
  hasn't been pushed yet.

Net: updates no longer depend on the `gh pr create` step or the repo toggle at
all. Push branch (auto) → app's Review & merge → Create PR → merge → deploy.

**Also considered and rejected (Jim's brainstorm):** GitHub *runners* (change
where a job runs, not the token's PR permission — wrong layer, and force users
to host a machine) and *webhooks* (outbound notifications only; can't open a PR,
and the version that could requires an operator-run service holding a repo
credential — the exact phone-home we forbid). Neither addresses the deploy/PR
problem; both were dropped.

**Still open (unchanged from #24):** deploy button can't force a public repo
(no visibility param), and the 60-day cron pause. Both are onboarding/concierge
candidates, not blockers.

### 26. Decision: the embedded AI must NOT build/deploy its own updates (2026-07-08)

Recurring idea worth settling on the record: "Chief has AI embedded — if it can
notify us of an update, can't the embedded Chief build the PR / apply the update
itself?" **Decision: no.** Reasoning, so we don't relitigate it:

- **"AI" is a red herring here.** Building the branch + PR is mechanical — the
  updater workflow already does it with zero intelligence, and that half works.
  The only things ever broken were *deploy* (fixed: public repo) and *reliable
  PR-open* (fixed: user-opened compare link + best-effort workflow). Neither is
  an intelligence problem, so an LLM adds nothing to the build step.
- **Capability tiers, not smarts.** Detecting/notifying is **read-only** (reads
  upstream's public release; no credential). Building/merging is a **repo-write**
  action needing a stored GitHub token. "We can notify" never implied "we can
  build" — different tier. The real proposal underneath "let Chief build it" is
  just "store a repo-write token," and the AI is incidental to that.
- **The hard line — never give the model a repo-write / code-deploy tool.**
  Chief's runtime ingests UNTRUSTED content (emails, web, connector data). A
  self-modification path reachable from that input is a prompt-injection route
  to Chief rewriting and deploying its own code — the worst failure mode for a
  self-hosted agent. This is exactly what BUILD-BRIEF's security rules and the
  write gate forbid: the model reads and *proposes*; the only writes go through
  `app/api/actions/execute` on explicit approval, and they touch the user's
  DATA, never code or infra. Updates-as-approve-first-proposals also means a
  human must review the code diff before merge; auto-build+merge would delete
  that review. So the AI is never the actor for code/deploy.
- **The only safe "one-tap" variant (shelved, not built):** a NON-AI Config
  button using the user's OWN narrowly-scoped fine-grained PAT (single repo;
  Pull requests: write, Contents: read) to *open* the PR — the user still
  merges. Sidesteps injection (no model tool) and preserves review, but costs a
  stored repo-write credential to manage and softens TRUST.md's "only you ever
  touch your repo," to save ~1–2 clicks over the compare-link flow we already
  ship. Marginal. If ever built: explicitly opt-in, off by default, never wired
  to the model. Not worth it now.

**Kept idea — where the embedded AI SHOULD help with updates:** on the review
step, have Chief READ the public diff/release notes and explain the update in
plain language ("changes X and Y, adds a migration to run, low risk") to help a
non-technical user decide to merge. Read-only, touches nothing, honors the write
gate — comprehension, not code-pushing. That's the right side of the line. Good
Phase-6/concierge candidate.

### 27. Updates ship CODE, not SCHEMA — the migration gap (2026-07-09, v0.4.3)

Surfaced building the Notes feature (v0.4.3), which adds a `notes` table. An
update lands as merge → deploy, which ships the new *code* but does NOT create
new *tables*. So a feature with a migration is broken on an existing instance
until the migration runs — and there was no in-app way to run it post-setup
(the setup screen only shows pre-claim; Config had no "apply update" button).
`/api/setup/migrate` already *allows* a signed-in owner to run pending
migrations (it needs `POSTGRES_URL_NON_POOLING`), but nothing in the UI called
it after an update.

**Handled for Notes (the pattern):** the Notes page detects its table is
missing (list throws), and instead of 500-ing renders a one-tap **"Apply
database update"** that POSTs `/api/setup/migrate` and reloads. Self-heal, no
SQL editor. This is the template every migration-bearing feature should follow
until there's a general "your instance has a pending database update — apply it"
prompt (a good global affordance to add next; also trivial in Cloud, where the
operator runs migrations centrally).

**Takeaway for the Sovereign edition:** "updates fully working" isn't just code
delivery — it's code **and** schema. Either auto-run pending migrations on boot
when `POSTGRES_URL_NON_POOLING` is present, or surface a global apply-update
prompt. Track this before shipping more migration-bearing features.

### 28. CORRECTION — UPDATES DO NOT WORK. Stop claiming otherwise. (2026-07-09, Jim)

**Entry 25's "proven end to end" is retracted as a general claim.** It described
ONE assisted run on ONE already-set-up instance, with an expert in the loop. It
is not evidence that the flow works for a user. As of today — roughly the TENTH
completely fresh deploy-button deploy — the update flow still does not work.
Any session reading this log: do NOT describe the update pipeline as working,
proven, or "close." "Close" has not converged after days of fixes.

**Observed on the latest fresh deploy:** the app's "Review & merge" deep link
(`…/compare/main...chief/upstream-update`) renders GitHub's *"There isn't
anything to compare — do they point to valid commits?"* — i.e. the
`chief/upstream-update` branch does not exist in the clone. On a fresh clone
the updater workflow is stripped by design (entry 19), so until auto-updates
are enabled AND a run has actually pushed the branch, that link points at a
branch that cannot exist. The UI presents an action that cannot succeed on
exactly the instance that most needs it. (Logged as the observed symptom; not
claimed to be the only remaining defect.)

**The independent verdict, even if the mechanics someday work:** the flow —
make repo public → enable auto-updates → PR-permission toggle → run workflow →
compare page → create PR → merge → apply DB migration — is far too complex for
a non-developer. Fixing the mechanics does not fix the audience problem. The
git/PR update pipeline should be treated as a developer-only path at best, and
further investment in polishing it is suspect (sunk cost).

**Status:** update delivery for user #2+ is an OPEN architecture problem, not a
bug queue. Candidate directions under discussion (see CLOUD-PLAN.md review):
accept dev-only updates; build for user #1 only for now (user #1 needs none of
this machinery — deploying straight from the upstream repo makes every merge an
auto-deploy); or redesign distribution away from git entirely (e.g. releases as
artifacts + in-app one-tap deploy via the user's own Vercel token, or an
app-store-style packaging platform). No direction chosen yet.

### 29. The deploy-from-source setup (4a) — a clean, working path FOR THE OWNER (2026-07-09)

Decision that came out of the entry-28 dead end: for now, **build for user #1
(Jim) only**, and stand the instance up by **deploying directly from the source
repo** rather than a deploy-button clone. This sidesteps the entire update
pipeline (entries 19–28) because there is no clone-vs-upstream gap: the instance
IS the source. Merge to `main` on `jim-homejab/ai-cockpit` → Vercel auto-deploys.
No workflow, no PR-into-a-clone, no public/private dance, no toggles. Proven
working end to end this session (`ai-cockpit-ten.vercel.app`, homejab Vercel).

**The setup that worked (all manual, all one-time, dev-appropriate):**
1. **Fresh standalone Supabase project** created directly at supabase.com (HomeJab
   org, free). Deliberately NOT the Vercel-Marketplace-provisioned one: a
   Marketplace DB's lifecycle can be coupled to the Vercel project that made it,
   so deleting deploy-button debris could deprovision the database. A standalone
   project has no such coupling — delete Vercel projects freely.
   - On the create form: **do NOT fill "GitHub (optional)"** (the Supabase
     GitHub integration). The app runs its OWN migrations; linking Supabase to
     the repo makes two systems apply `supabase/migrations/*.sql` with separate
     ledgers. Also moot here — the repo has no `supabase/config.toml`, so the
     integration wouldn't work cleanly anyway. Keep one migration source: the app.
   - Security toggles: Enable Data API ON, Automatically expose new tables ON
     (RLS is the real gate), automatic RLS OFF (migrations enable RLS per-table).
2. **Vercel project on the homejab team**, imported from `jim-homejab/ai-cockpit`
   directly (Add New → Project → Import Git Repository). Delete any old
   deploy-button Vercel project pointing at the same repo, or both auto-deploy on
   every push.
3. **Four env vars pasted by hand** (the Marketplace normally injects these; here
   you do it once): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (= the new **publishable** key; `lib/supabase/env.ts` accepts either name),
   `SUPABASE_SERVICE_ROLE_KEY` (= the new **secret** key), and
   `POSTGRES_URL_NON_POOLING` (= Supabase → **Connect → Session pooler** URI,
   port 5432, with `[YOUR-PASSWORD]` filled in; NOT the Transaction pooler on
   6543 — DDL misbehaves there, and NOT Direct connection, which is IPv6-only and
   Vercel serverless can't reach). Note: `POSTGRES_URL_NON_POOLING` is only an
   env-var NAME — there is no Supabase field by that label; its value is just the
   connection string.
4. **First render = onboarding, as designed**: "Set up my database" (one tap ran
   all six migrations) → create login in-app → sign in. AI replied immediately on
   the gateway default once a **credit card** was on the homejab Vercel account
   (entry 22's gate — card required even for free models).

**One gotcha worth flagging: Vercel Deployment Protection.** A homejab-team
project came up with Vercel Authentication ON, which 403s all anonymous
requests. The app rendered fine in the owner's Vercel-authenticated browser but
was unreachable from a logged-out phone and would 403 the Proactive Chief webhook
(`/api/events/pipedream`). Fix: project **Settings → Deployment Protection →
disable Vercel Authentication** (three separate toggles live there — Vercel
Authentication, Password Protection, Trusted IPs; also check Settings → Firewall
if still blocked). Safe to disable — the app has its own single-user login and
RLS. Acceptance test that actually proves it: open the production URL on a phone
in an **incognito** tab (not signed into Vercel); it should load the Chief login.
(Automated/server-side fetches from a datacenter IP may still get 403 from
Vercel's bot filter even when the site is fully public — the incognito-phone test
is the real check, not a curl/WebFetch from a helper.)

**Scope — be honest about what this does and doesn't solve.** It fully solves the
OWNER's setup and updates. It does **NOT** solve distribution for user #2+ — that
is still entry 28's open problem. This is "build for myself first," not a general
answer. When the app is good enough to give away, the user-#2 update question
still has to be answered (or explicitly scoped to developers only).
