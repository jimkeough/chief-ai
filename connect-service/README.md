# Chief Connect — the vendor token service

The one piece of Chief that does NOT run on the user's infrastructure. It
holds the operator's Pipedream Connect credentials and hands each paying
deployment exactly three things: a short-lived Pipedream access token (to call
their own connectors' MCP servers), hosted Connect Links (to authorize apps in
two clicks), and their connected-account list.

**What it can see:** which apps a customer has connected, and the tokens
Pipedream manages for those apps.
**What it can never see:** the customer's database, Anthropic key, email
archive, app passwords, tasks, memory — none of that ever touches this
service. And every customer can eject at any time: each connector has a
sovereign twin (app password, own OAuth client, direct MCP URL) configured in
the app itself.

## Deploy (operator: you)

A standalone Vercel project — deploy this folder only:

```bash
cd connect-service && vercel deploy --prod
```

Environment variables:

- `PIPEDREAM_CLIENT_ID` / `PIPEDREAM_CLIENT_SECRET` — OAuth client from
  pipedream.com → Settings → API.
- `PIPEDREAM_PROJECT_ID` — the Connect project (proj_…).
- `PIPEDREAM_ENVIRONMENT` — `development` while testing, `production` live.
- `CONNECT_KEYS` — comma-separated `key:externalUserId` pairs, one per
  customer, e.g. `ck_9f2h8...:usr_a81b3c...`. Issue a key by generating two
  random strings (`openssl rand -hex 16` each) and adding a pair; revoke by
  removing it. The externalUserId is the customer's tenant id inside your
  Pipedream project — random and unguessable by design.

## API

Every request: `Authorization: Bearer <customer key>`. The customer's
externalUserId comes from the key — it is never accepted from the caller, so
one customer cannot address another's connections.

- `POST /api/mcp-token` → `{ accessToken, expiresAt, projectId, environment, externalUserId }`
  — what a Chief deployment needs to call `remote.mcp.pipedream.net` for its
  own connectors.
- `POST /api/connect-link` `{ app? }` → `{ connectLinkUrl, token, expiresAt }`
  — hosted managed-OAuth flow; append `&app=<slug>` to target one app.
- `POST /api/accounts` → `{ accounts: [{ id, app, name, healthy }] }`
- `POST /api/disconnect` `{ accountId }` — verifies the account belongs to
  this customer before deleting.

## Honest limitations (MVP)

The Pipedream access token returned by `/api/mcp-token` is project-scoped
(Pipedream doesn't issue per-end-user MCP tokens today). Customer isolation
rests on (a) keys mapping to random, unguessable externalUserIds and (b) this
service never disclosing one customer's id to another. A future hardening step
is proxying MCP calls here and pinning the externalUserId server-side.
