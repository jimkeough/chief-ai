# Chief Cloud — build plan (for review)

Status: **proposal, under review.** Companion to `CLOUD.md` (which records the
decision + trust boundary + migration-safe invariants). This document is the
how — written to stand on its own so it can be handed to another reviewer.

## 0. Context (for a reviewer with no prior history)

**Chief** is a single-user "AI chief of staff" web app: Next.js (App Router) on
Vercel + Supabase (Postgres/Auth/RLS) + an LLM (Claude via Vercel AI Gateway or
a user's own Anthropic key). The AI can read and *propose*; the only code path
that writes is a single approve-first executor, and every write is journaled.
Core surfaces: Home, Inbox (email triage), Chief (chat), Projects, Tasks, Notes,
Settings.

**Today it's self-hosted-first:** each user deploys their own copy to their own
Vercel + Supabase. That gives real sovereignty but the **update path is unusable
for non-technical / mobile users** — proven the hard way (the Vercel clone
strips the CI workflow, the re-add link breaks, non-fork repos can't take
cross-repo PRs, and there's no terminal on a phone). See `SETUP-FRICTION.md`.

**Decision already made:** pivot to **hosted app, sovereign data plane** —
*Chief Cloud* (default; we host + auto-update) and *Chief Sovereign* (the
existing self-host, as the technical tier and the credible "eject" path). The
promise shifts from "you own the whole deployment" to **"you own your data, AI
billing, approvals, and exit; we host the runtime so updates just work."**

## 1. Current architecture (starting point)

- **One Vercel deployment per user**; being signed in to that deployment IS
  authorization (single Supabase Auth user).
- **Per-user Supabase**; every table has `user_id default auth.uid()` + an RLS
  `_own` policy.
- **AI**: default routes through Vercel AI Gateway using the *deployment's* OIDC
  token (per-deployment, zero-key); alternatively a user's own Anthropic key
  stored in their DB.
- **Config & secrets** live in the user's Supabase (not env) — deliberately,
  and mostly true today.
- **Write gate**: `POST /api/actions/execute` is the only writer; journaled.
- **Connectors**: MCP broker; optional operator-run "Chief Connect" brokering
  Pipedream OAuth.

## 2. Target

One **multi-tenant hosted app** serving N users. We ship code/updates once. Each
user keeps: their data, their AI billing, their connector grants, the approval
gate, and a one-click exit. The operator stores as little as possible.

## 3. The one decision everything hinges on — where does tenant data live?

This is the crux and the thing most worth an outside pressure-test.

- **Model A — user-owned Supabase (true sovereign data plane).** Each user
  brings/creates their *own* Supabase project. Cloud stores only a pointer +
  encrypted connection creds + their AI key. Durable data never sits in operator
  infrastructure.
  - *Pro:* strongest promise; eject is trivial (point the self-host edition at
    the same DB).
  - *Con:* hard. Per-request dynamic DB connections, running migrations across N
    separate databases, connection pooling/limits, and **onboarding friction** (a
    normal user provisioning/authorizing a Supabase project — the exact kind of
    setup step that pushed us off self-host in the first place).

- **Model B — operator-run store with per-user isolation + strong export.**
  Cloud runs the database; users' data isolated by `user_id`/RLS (or
  schema-per-user). "Sovereignty" delivered via a genuine one-click full export
  + the Sovereign self-host edition as the real eject.
  - *Pro:* standard, far simpler, easy migrations, low onboarding friction.
  - *Con:* operator holds the data at rest — weaker "we can't see it" claim;
    eject is an export/restore, not "your data was never ours."

- **Model C — hybrid / phased.** Ship B first (fast path to a real product),
  architect the tenant seam (§4) so A is a later opt-in for privacy-max users,
  with Sovereign self-host as the eject throughout.

**Current lean (explicitly a lean, not settled):** Model C — start B, keep the
door to A open, lean on Sovereign as the true eject. Rationale: most
*user-perceived* sovereignty (my data isn't locked in, I can leave, writes are
gated, I can self-host the identical open-source app) is deliverable without
per-user Supabase, and Model A's infra cost (provisioning + N-database
migrations) could sink the project before it ships. **The honest cost of C:** it
walks back "the operator never holds your data at rest," which was part of the
sovereign-data pitch — so it's a real trade, not free. This is the decision most
worth a second opinion.

## 4. The key refactor that unblocks everything (do this regardless of A/B/C)

Introduce a **tenant-context seam.** Everywhere the app obtains a Supabase
client, an AI client, or config, route it through a resolver:

- Today (Sovereign): the resolver returns the single deployment's Supabase / AI
  / config from env + the one user's DB.
- In Cloud: the resolver returns the *current tenant's* Supabase / AI / config,
  looked up from the signed-in Cloud identity.

Concretely: a `getTenant()` / `tenantClient()` layer that `lib/supabase/server`,
`lib/ai`, and `lib/settings` call. No feature code changes; only the plumbing
under it. This is the migration-safe seam that lets feature work continue now and
Cloud slot in later. Cheap insurance; land it early.

## 5. Hard problems to design (mostly Model-A-specific, lighter under B)

1. **Auth across tenants.** Today auth = per-deployment Supabase Auth (RLS by
   `auth.uid()`). Cloud needs a Cloud-level identity that maps login → tenant
   record. Each tenant DB is effectively single-user, so RLS-by-session matters
   less than it looks; the runtime likely connects to the tenant DB with a
   service credential and scopes to that one user. Reconciling this cleanly is
   the thorniest bit under Model A.
2. **Secrets store.** Encrypted-at-rest store (KMS-backed) for each tenant's DB
   connection + AI key. This is the sensitive asset; design carefully (envelope
   encryption, rotation, least privilege).
3. **Migrations across N databases** (Model A / C-later). A tenant-aware
   migration runner: eager (iterate all tenants on deploy) vs lazy (run pending
   on a tenant's first request post-deploy). Lazy is more robust at scale. Under
   B this is a normal single-DB migration — much simpler.
4. **AI billing without the OIDC trick.** The per-deployment gateway token is
   gone in Cloud. Options: (a) **BYO Anthropic key** per user (keeps AI billing
   sovereign; a little onboarding friction) or (b) **operator-metered** (we pay
   Anthropic, meter + bill the user; simplest onboarding, but operator bears
   cost/markup and sits in the billing path). Decide for v1.
5. **Connectors per tenant.** Map Chief Connect / Pipedream grants per user.
6. **The honest give.** In Cloud, operator servers assemble prompts that contain
   user content (email bodies, notes) in transit. State this plainly in
   `TRUST.md` regardless of A/B/C.

## 6. Suggested phasing (avoid a big-bang rewrite)

- **Phase 0 —** hold the migration-safe invariants (see `CLOUD.md`).
- **Phase 1 —** land the **tenant-context seam** (§4). App still runs
  single-tenant; no behavior change. *Foundation, low-risk.*
- **Phase 2 —** Cloud identity + tenant directory + encrypted secrets store.
- **Phase 3 —** onboarding: connect AI key + (Model A) create/connect Supabase,
  or (Model B) auto-provision the tenant's isolated store. **Make-or-break UX** —
  the reason we left self-host was setup friction, so this must be near-zero.
- **Phase 4 —** migration runner (trivial under B, real under A).
- **Phase 5 —** billing / subscription.
- **Phase 6 —** cutover: Cloud is the default; Sovereign stays as the documented
  eject.

## 7. Open questions for review

1. **A vs B vs C** — is per-user-Supabase (A) worth the complexity, or is
   "operator store + real export + Sovereign eject" (C) a defensible
   "sovereign-enough" v1? What would you ship first?
2. **Auth** — best pattern for Cloud-identity → per-tenant data, especially
   under Model A?
3. **Onboarding a tenant's data store with minimal friction** — Supabase
   OAuth / Management API to create a project on the user's account? An
   operator-created project handed to the user? Something else?
4. **AI billing** — BYO key vs operator-metered for v1?
5. **Migrations across many tenant DBs** — eager, lazy, or avoid the problem by
   choosing B?
6. **Is there a simpler shape** that still delivers "own your data + credible
   exit" without per-user Supabase (e.g., schema-per-user in one operator
   cluster with direct per-user DB credentials + export)?
