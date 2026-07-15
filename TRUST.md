# The trust ledger

Chief's architecture is **sovereign core, optional brokered edges**. This file
is the exact accounting of what runs where, what each party can see, and how
to leave. If any code change contradicts this file, the code is wrong.

## The sovereign core (always)

Everything below runs on infrastructure **you** own and bill:

- **The app** — your Vercel project, cloned byte-for-byte from this public
  repo (compare any time: your clone vs. upstream is one GitHub diff). Keep the
  clone **public**: it carries no secrets (`.env` is gitignored; every
  credential lives in your database, below), and a public clone is what lets
  updates deploy for free — so nothing about your setup is exposed by it, and
  updates "just work" (see *Updates*, below). Your data plane stays private
  regardless of repo visibility.
- **Your data** — your Supabase project: tasks, projects, memory, contacts,
  Chief chat history and privately stored document sources, the communications
  log, the journal, settings, and any credentials you paste (email app password,
  Google refresh token). Row-level security on every table and user-scoped
  policies on Chief's private Storage bucket.
- **Your AI** — by default, routed through Vercel AI Gateway on **your own**
  Vercel project: the deployment's OIDC token authenticates and usage bills
  to your Vercel account, so there is no key to fetch. Prefer prompts that go
  only to Anthropic? Flip one setting to direct-Anthropic mode with your own
  API key — see below.
- **The write gate** — Chief can read and propose; the ONLY code path that
  performs a write is `app/api/actions/execute`, on your explicit approval.
  Reversible actions carry Undo; sending email requires slide-to-confirm.
  Every executed action lands in the append-only journal.
- **Document imports are compiled, not improvised.** Uploaded sources are
  treated as untrusted content and split into bounded extraction batches. The
  model returns semantic product entities with source evidence, never action
  calls or SQL. App code reconciles those entities with the live workspace and
  compiles only actions from the executor's allowlist. Each batch is a separate
  request, and nothing bypasses approval.
- **Proactive events stay proposals.** When you turn on "notify me when…"
  (Config → Connections), Pipedream pushes events to `/api/events/pipedream`.
  That endpoint has no session, so it uses the Supabase service-role key —
  the one sanctioned exception to the session-client rule — and only after
  verifying the unguessable per-trigger token (plus Pipedream's signature).
  An incoming event can update your board and *queue* a proposal; it can
  never act on its own. Leave `SUPABASE_SERVICE_ROLE_KEY` unset and the whole
  proactive path is simply off.

No telemetry or phone-home is required for the core. It works end-to-end with
email over an app password and connectors as direct MCP URLs. The default
guided connector path below uses the Pipedream account you create and control.

## Updates (sovereign, approve-first)

The trust contract applies to Chief's own evolution: **the app never updates
itself silently.** New versions arrive as pull requests into *your* repo that
*you* review and merge — merging is what deploys them. No operator ever pushes
code to you, and there is no auto-update daemon.

- **Detection is read-only.** Your deployment compares its own bundled version
  to upstream's latest **public** GitHub release (`/api/updates/status`). It
  reads a public fact; it needs no token and touches nothing of yours. The
  same public releases power the [changelog](/changelog).
- **Delivery stays in your accounts.** A weekly GitHub Action *in your repo*
  opens the update PR; you merge it in your own GitHub; your own Vercel
  deploys it. Chief holds no credential to any of this — every button in
  Config → Software updates just lands you in your own authenticated GitHub.
- **Why the clone is public.** It's the delivery mechanism, not a give: a
  public repo lets your free Vercel plan deploy the updater's merge commits.
  The repo holds no secrets, and your data plane (below) is private either way.
  Staying private is possible but costs friction (Vercel Pro, or merging
  locally so the commit is authored by you).

## AI Gateway (the default)

Chief's model calls route through
[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) by default. Why it's
the default: **no key to fetch** — no separate console.anthropic.com account —
and one endpoint reaches any model (Claude, GPT, Gemini, …). Auth is your
deployment's OIDC token, read at runtime; nothing to paste.

**Zero-key, not zero-cost — the honest version.** The gateway requires a
**payment method on your Vercel account** to service any request (Vercel's
anti-abuse gate). With a card on file, **free-tier models run at $0**;
**premium models (Opus) need paid credits** (a top-up, ~$10 minimum) — *or*
bring your own Anthropic key (below). So the "API-key cliff" didn't vanish, it
moved from Anthropic to the Vercel account you already made for the deploy —
one account instead of two. Chief ships a **free-model fallback** so a premium
model your account can't reach degrades to a working one instead of erroring.

**Bring your own key (BYOK).** Paste your own Anthropic key in Config → *AI
Gateway — bring your own Anthropic key*, and premium models run on **your
Anthropic billing**, routed through the gateway (no Vercel top-up). Your key is
stored only in your own database and sent to the gateway per request.

**Why this stays sovereign:** you deploy your OWN Vercel project, so gateway
traffic authenticates with *that* project's auto-injected OIDC token and bills
to *your* Vercel account. There is no Chief operator, shared service, or
subscription in the path. The `chief.model`
setting stays yours to control (it just accepts gateway model ids like
`anthropic/claude-opus-4.7` or `openai/gpt-5`).

**The one honest give:** in gateway mode your prompts pass through Vercel (your
own vendor), which meters them — where in direct mode they go only to
Anthropic. That is the whole difference.

**Ejecting:** flip **AI — provider** to `anthropic` and set your
`ANTHROPIC_API_KEY`. One setting, and the layer is gone. (The reverse courtesy
also holds: gateway mode with no gateway credential in sight falls back to a
present Anthropic key rather than failing.)

**Caveat:** connectors are unaffected by the provider choice — the app brokers
MCP servers itself and hands the model plain tools. The one Anthropic-native
piece is the optional server-side web fetch tool (off by default), which the
gateway's Anthropic-compatible endpoint may not proxy; flip to direct
Anthropic mode if you turn it on and it misbehaves.

## Pipedream Connect (owner-operated)

Pipedream is Chief's default connector provider, but there is no shared Chief
Connect operator anymore. You create and control the Pipedream account and
Connect project. The one-time flow in Config stores the project's OAuth client
ID and secret as one encrypted Supabase Vault value. Browser roles cannot call
the decrypting RPC, and Chief's APIs return only project metadata plus a
`configured` boolean.

Chief uses the authenticated Supabase user UUID as Pipedream's
`external_user_id`. It is stable, unique in this deployment, and comes from the
verified session rather than a request body. Pipedream binds connected accounts
to that identifier. Hosted authorization uses a short-lived Connect Link; the
project client credentials never go to the browser.

**What Pipedream can see:** which apps and accounts you connect, the OAuth
grants it manages for those apps, connector tool requests and results that
pass through its MCP service, and Connect API Proxy requests Chief makes to
fill gaps in prebuilt actions (for example Front Core API search). Optional
owner-published private actions run in the same owner-controlled Pipedream
workspace and receive only the connected account grant and inputs needed for
that action. That is the managed-connector give.

**What Pipedream cannot see through this integration:** your Supabase database,
AI credential, email app password, unrelated tasks, projects, memory, chat
history, or approval decisions. Chief sends only the app/account-scoped MCP
or proxy request needed for a selected connector operation.

**Scoping and the gate:** each connected Pipedream account is a separate logical
Chief connection. Its MCP session includes the project, environment,
`external_user_id`, app slug, and account ID, so Chief never receives
Pipedream's full cross-app catalog. Chief requests both the public registry and
private actions the owner explicitly published to that same project and
environment. Connect Proxy calls use the same project credentials and the
specific connected account ID; Chief-built proxy helpers that are read-only
(such as Front conversation search) run as transparent read tools, while every write,
send, or delete still defaults to Ask through the broker, proposal card, live
permission re-check, executor, and journal. Optional Config
`pipedream.front_oauth_app_id` selects an owner-created Pipedream OAuth client
for Front (for example one with Private Resources) instead of Pipedream's
default Front app when connecting that account.

**Ejecting:** disconnect the account in Config to delete its Pipedream grant.
Direct remote MCP remains available under **Advanced · Direct MCP**, so no
Chief-operated connector service is required.

## Verify it yourself

1. **Diff your clone** against this repo on GitHub — nothing can be slipped
   into your copy silently.
2. **Independent audit**: paste this repo into any AI you trust — outside this
   app — and ask it to look for backdoors, exfiltration, or writes that bypass
   `app/api/actions/execute`. (An audit run by the thing being audited can
   only ever be a convenience, so run it elsewhere.)
3. **Watch the network**: the app's outbound calls go to your Supabase, your AI
   provider, your mail server, direct MCP servers you configure, and — when you
   enable the default connector provider — Pipedream's API, MCP service, and
   Connect API Proxy (for authenticated upstream API calls on your behalf).
