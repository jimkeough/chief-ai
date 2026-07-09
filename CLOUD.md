# Chief Cloud — target architecture & migration guardrails

Status: **planned, not built.** This is the agreed direction (recorded so
feature work done on the Sovereign edition stays portable). Nothing here ships
until the app is feature-ready and we deliberately stand up hosting.

## The decision

Chief moves from *self-hosted first* to **hosted app, sovereign data plane**:

- **Chief Cloud (default).** We host the app code and ship updates once, for
  everyone. The user still owns the parts that matter: their **data** (their own
  Supabase project), their **AI billing** (their own Anthropic key), their
  **credentials/connectors**, the **approval gate**, and a real **exit**.
- **Chief Sovereign (advanced / eject).** The current deploy-to-your-own-Vercel
  path. For technical and privacy-maximal users — and, just as important, the
  *credible exit* that makes Cloud trustworthy: "we host it so it just works;
  here's the door — take your data and run the whole thing yourself, anytime."

**Why the flip.** We proved the sovereign update path works end to end on a free
Vercel Hobby account (public clone → PR → merge → deploy). Proving it also
proved the point: its terminal steps — merge a GitHub PR, run a workflow, watch
a Vercel dashboard — are developer-shaped. No walkthrough turns "merge a pull
request" into a consumer action, and setup (Vercel signup, Supabase
provisioning, payment method, make-repo-public) is just as steep. For the actual
target user, self-host-as-default is not viable. But sovereignty's *value* to a
user — own your data, your AI billing, your approvals, your exit — never
required them to own the code-deployment pipeline. Cloud keeps the value and
drops the developer tax.

## The trust boundary (what the operator can and cannot see)

The promise changes from "you own the entire deployment" to **"you own your data,
AI billing, credentials, approvals, and exit; we host the UI/runtime so you
always get updates."** To keep that honest:

**The operator (Chief Cloud) stores as little as possible:**

- A pointer to the user's Supabase project + connection settings (encrypted at
  rest), and the user's AI key (encrypted at rest) — the minimum needed to run
  the app against *their* data plane.
- No durable copy of the user's tasks/projects/notes/communications/journal.
  Those live only in the user's Supabase.

**The operator's servers necessarily see, in transit (not stored):**

- The prompts Chief assembles — which include user content (email bodies,
  notes, project state) — because the runtime runs on our infra. This is the
  one real give versus full sovereignty. Be honest about it in `TRUST.md`.

**The operator can never:**

- Bypass the approval gate. Writes still go through the single executor on the
  user's explicit approval; Cloud does not change the write contract.
- Take the user's data hostage. Export/eject is one click (below).

**The user's Supabase remains the durable record:** tasks, projects, notes,
communications, journal, settings, contacts, memory, approval receipts — all
under their own RLS.

## The eject path (must stay real)

1. The user's data already lives in their own Supabase — nothing to migrate.
2. They deploy the open-source **Sovereign** edition (the current deploy button)
   and point it at the same Supabase project + their AI key.
3. They blank the Cloud connection. Done — same data, now fully self-hosted.

The Sovereign edition existing and working is what makes this credible. That is
why the update work was not wasted: it is the door.

## Migration-safe invariants (follow these while building features on Sovereign)

Building features now on the single-tenant Sovereign app is the right move (fast
loop, you are your own user). The migration to Cloud stays cheap **only if**
feature work respects these. Violate them casually and Cloud becomes a refactor.

1. **Per-user config & secrets live in the user's Supabase, never in host env
   vars.** One shared Cloud deployment cannot hold per-user env. The app already
   leans this way (config in the DB) — keep it strict. `.env` is for
   *operator/deployment* config only, never per-user data.

2. **Assume bring-your-own AI key.** Today's zero-key default rides the Vercel
   deployment's OIDC gateway token — inherently *per-deployment*, so it cannot
   survive a shared host. Cloud almost certainly means each user's Anthropic key
   in their own DB (already supported via `ai.byok_anthropic_key`). Build and
   test features against the BYO-key path; don't let anything depend on the
   OIDC-gateway magic being present.

3. **Keep the data plane exactly as it is** — the user's own Supabase, RLS by
   `auth.uid()` on every table. This is the part that ports unchanged and *is*
   the sovereign-data promise. New tables: same `user_id default auth.uid()` +
   `_own` RLS policy as every existing table (see any migration).

4. **No single-deployment / single-user assumptions beyond what RLS gives.** No
   global singletons, no "there is exactly one user" shortcuts in code. RLS
   already scopes everything to the session user; rely on that, not on the
   deployment being one person's.

5. **Never phone home from the Sovereign edition.** No telemetry/analytics that
   ship user data off the instance (TRUST.md). Cloud is opt-in by *running*
   Cloud; the self-hosted build stays silent.

Keep these five and every feature you build now ports to Cloud for free.

## Not yet decided (defer until we build Cloud)

- Auth model across tenants (likely per-user Supabase Auth as today, with a thin
  Cloud directory mapping login → their project pointer).
- Billing/subscription for the hosted convenience.
- How connectors (Chief Connect / Pipedream) map per-tenant.

These are Cloud-build decisions; they do not affect feature work today.
