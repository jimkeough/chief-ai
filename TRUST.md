# The trust ledger

Chief's architecture is **sovereign core, optional brokered edges**. This file
is the exact accounting of what runs where, what each party can see, and how
to leave. If any code change contradicts this file, the code is wrong.

## The sovereign core (always)

Everything below runs on infrastructure **you** own and bill:

- **The app** — your Vercel project, cloned byte-for-byte from this public
  repo (compare any time: your fork vs. upstream is one GitHub diff).
- **Your data** — your Supabase project: tasks, projects, memory, contacts,
  the communications log, the journal, settings, and any credentials you
  paste (email app password, Google refresh token). Row-level security on
  every table.
- **Your AI** — by default, your Anthropic API key, sent only to Anthropic.
  (Optional AI Gateway mode routes through your own Vercel account instead —
  see below.)
- **The write gate** — Chief can read and propose; the ONLY code path that
  performs a write is `app/api/actions/execute`, on your explicit approval.
  Reversible actions carry Undo; sending email requires slide-to-confirm.
  Every executed action lands in the append-only journal.

No telemetry, no phone-home, no vendor account required. The app works
end-to-end in this mode: email over an app password, connectors as direct
MCP URLs you configure yourself.

## AI Gateway (optional)

Instead of a direct Anthropic key you can route Chief's model calls through
[Vercel AI Gateway](https://vercel.com/docs/ai-gateway) — turn it on in Config
(**AI — provider** = `gateway`). Why you might: one endpoint reaches any model
(Claude, GPT, Gemini, …) and there's no `console.anthropic.com` key to fetch.

**Why this stays sovereign:** you deploy your OWN Vercel project, so gateway
traffic authenticates with *that* project's auto-injected OIDC token and bills
to *your* Vercel account. There is no operator in the path — unlike Chief
Connect, this needs no shared service and no subscription. The `chief.model`
setting stays yours to control (it just accepts gateway model ids like
`anthropic/claude-opus-4.7` or `openai/gpt-5`).

**The one honest give:** in gateway mode your prompts pass through Vercel (your
own vendor), which meters them — where in the default mode they go only to
Anthropic. That is the whole difference.

**Ejecting:** flip **AI — provider** back to `anthropic` and set your
`ANTHROPIC_API_KEY`. One setting, and the layer is gone.

**Caveat:** gateway mode is best-effort for Chief's heaviest turn — server-side
tools (web fetch) and remote MCP connectors rely on Anthropic-native betas the
gateway's Anthropic-compatible endpoint may not proxy. The lighter calls (home
line, email read, KB classify/merge) work the same either way. Prefer the
default Anthropic mode if you rely on connectors.

## Chief Connect (optional, paid)

A small operator-run service (`connect-service/`) that makes connecting apps
(Gmail, Calendar, Notion, Slack, …) two clicks instead of a DIY OAuth setup,
by brokering Pipedream Connect's managed OAuth. The subscription price exists
to cover that real third-party cost.

**What it can see:** which apps you've connected, and the OAuth tokens
Pipedream manages for those apps (that's what managed OAuth is).

**What it can never see:** your database, your Anthropic key, your email
archive or app password, your tasks, projects, memory, or approvals. None of
that ever touches the service — the app talks to your connectors' MCP servers
directly; the service only issues short-lived access tokens.

**The gate is unchanged:** Chief Connect tools flow through the same broker
as everything else — reads run transparently, anything that writes becomes an
approval card you can dismiss.

**Ejecting:** every Connect app has a sovereign twin — email via app password
or your own Google OAuth client, any other service via a direct MCP server URL
in Config. Disconnect an app in Config (the grant is deleted at Pipedream),
blank the two Chief Connect settings, and the layer is gone.

## Verify it yourself

1. **Diff your clone** against this repo on GitHub — nothing can be slipped
   into your copy silently.
2. **Independent audit**: paste this repo into any AI you trust — outside this
   app — and ask it to look for backdoors, exfiltration, or writes that bypass
   `app/api/actions/execute`. (An audit run by the thing being audited can
   only ever be a convenience, so run it elsewhere.)
3. **Watch the network**: the app's outbound calls go to your Supabase, the
   Anthropic API, your mail server, MCP servers you configured, and — only if
   you subscribed — your Chief Connect service.
