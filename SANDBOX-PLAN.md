# Chief sandbox dev-environment — build plan (for review)

Status: **direction decided (2026-07-20); build starting.** Companion to
`DEVLOOP-PLAN.md` and `DEVMODE-PLAN.md` (which shipped the review-gated
GitHub → Vercel loop: Chief reads the repo over the GitHub MCP, proposes a
branch + commits + PR as gated cards, you merge, Vercel deploys). This document
describes the **richer version of that loop**: instead of editing through
whole-file MCP pushes, Chief spins up an on-demand Linux sandbox, launches a
coding agent that edits and *runs* the code there (typecheck, tests, dev
server), and only then opens the same reviewable PR. Written to stand on its own
so it can be handed to another reviewer.

**Decision taken (the crux, resolved in review):**

- **Delegate the engineering to Claude Code, don't hand-roll an agent.** Chief
  becomes the *product interface + orchestrator*; **Claude Code (headless)** is
  the engineer that reads, edits, runs, and fixes the code. Chief understands the
  request and the current screen, manages permissions, and presents the result
  in its existing chat. This is dramatically less to build and preserves nearly
  all the product work already shipped.
- **Host the box in a Vercel Sandbox** the app launches on demand — chosen over a
  GitHub-Actions-hosted agent because it lets Chief run the app in-VM and stream
  a **live preview into chat** (the whole point of a slick "Update this app"),
  and it sits naturally next to the Vercel-hosted app.
- **Sovereign edition only** (see §6 — this is a scoping *fit*, not a
  compromise).
- **The trust contract does not move.** Claude Code opens a PR; **you** merge;
  Vercel deploys.

These are verified as buildable, not aspirational:

- Vercel ships a guide for exactly this: *"Using Vercel Sandbox to run Claude's
  Agent SDK"* — <https://vercel.com/kb/guide/using-vercel-sandbox-claude-agent-sdk>
- …and an open-source, **engine-selectable** starting point: the *Coding Agent
  Platform* template (Claude Code, Codex CLI, Copilot CLI, Cursor CLI, Gemini
  CLI, opencode) — <https://vercel.com/templates/next.js/coding-agent-platform>.
  Adapt this rather than build from scratch; it also delivers "make the engine
  selectable later" for free.
- Claude Code headless is real: `claude -p`, `--output-format stream-json`,
  turn limits, and `--allowedTools` for controlled permissions.
- Reality check on latency: a sandbox launches in **seconds, not milliseconds**
  (cold start + `npm install`); a warm base snapshot is what makes it feel fast.

## 0. What was asked, and what this doc is

> "Why can't Chief use its own environment and edit code more directly? It's
> illogical that Chief wouldn't have an environment when it's already in one."

The honest answer (see the discussion that produced this doc):

- **Chief's production runtime is not a dev environment.** It runs inside a
  deployed Vercel Function: read-only filesystem except `/tmp`, ephemeral and
  horizontally scaled, holding the *compiled bundle* — not a git checkout. It
  literally cannot be its own workshop. `lib/chief.ts` already tells the model
  this in dev mode: *"You have NO shell, no code-execution environment, and no
  local filesystem."*
- **So "give Chief an environment" means: create one on demand,** beside the
  running app, not inside it. That is what a sandbox microVM is.

The architecture is now settled (see the decision box above); what remains is a
phased build (§7). The trust contract and the edition scope are fixed:

- **The trust contract does not move.** Claude Code opens a PR; **you** merge;
  Vercel deploys. The sandbox changes *how the change is authored*, never who
  ships it.
- **Sovereign edition only.** Build on the single-deployment edition, where one
  user's VM runs on that user's own Vercel account, on their dime, in their trust
  boundary. This is where self-editing is *coherent* — §6 explains why it does
  not belong in Cloud at all.

## 1. Why this is worth doing (and where today's loop hurts)

The shipped MCP loop (`DEVMODE-PLAN.md`) works, but its ceiling is real:

- **It edits blind.** Chief fetches individual files over MCP, reconstructs
  context in the prompt, and submits whole-file writes. It cannot run
  `npm run typecheck`, a test, or the app before pushing — CI on the PR is its
  *first* real signal, minutes later.
- **The verify half is post-hoc.** `check_routes` + the PR's Vercel status check
  only run *after* the preview builds. A type error or a broken import is caught
  by CI, not by Chief, so the round-trip is: propose → wait → read logs → fix →
  wait again.
- **Context is expensive and lossy.** Every file Chief needs is a tool round-trip
  and a chunk of prompt budget; it can't grep the tree cheaply. (This same
  budget pressure is implicated in the dev-mode stall being debugged alongside
  this doc.)

A sandbox collapses that into the loop a human engineer actually runs:
`git clone` → inspect → edit → `npm install` → `npm run typecheck` → test →
`npm run dev` → self-verify → commit → push → open PR. Chief catches its own
type errors *before* the PR exists, and the PR that lands is one it has already
seen build.

## 2. What already exists (so we don't rebuild it)

- **Dev mode is already a distinct persona + narrowed toolset.**
  `lib/chief.ts` (`mode: "dev"`) and `app/api/chief/route.ts` load the engineer
  prompt, the auto-detected `DeployTarget` (`lib/deploy-target.ts`), and only the
  GitHub/Vercel/Supabase apps. The sandbox is a new *execution backend* for that
  same persona, not a new surface.
- **The repo already knows how to run itself in a fresh VM.** `AGENTS.md` §"Running
  the app locally" documents the exact bring-up (`sudo dockerd &`,
  `supabase start`, the fixed local demo keys, `npm run dev`,
  `/api/setup/health`). A sandbox provisioning script is largely a transcription
  of that section.
- **The PR/merge/deploy rail is done.** `create_branch` / `push_files` /
  `create_pull_request` enrichment cards, CI (`npm run typecheck`,
  `release:check`), and `RECOVERY.md` break-glass all exist. The sandbox pushes
  onto the *same* rail.
- **Break-glass recovery already assumes a bad merge can happen** (`RECOVERY.md`:
  Vercel instant-rollback + GitHub revert). That safety net is what makes a more
  capable authoring step acceptable — recovery does not depend on Chief.

## 3. The loop, end to end

```
Chief (orchestrator)        Vercel Sandbox + Claude Code       GitHub / Vercel
────────────────────        ────────────────────────────      ───────────────
1. user asks for a change
2. spin up sandbox ───────►  clone repo @ default branch
                             npm install (warm snapshot)
3. launch Claude Code ────►  claude -p (headless): read / grep /
                             edit across files, on a real fs
4. Claude Code runs ──────►  npm run typecheck / test
   checks in-VM              npm run dev + hit key routes
5. self-verify ◄──────────   pass/fail + logs + (optional) screenshot
   (if red: Claude Code fixes in-VM, loops 4)
6. open PR ────────────────────────────────────────────► branch + push + PR
7. Chief presents result ◄── live preview + diff, in existing chat
8. PR builds preview ──────────────────────────────────► Vercel preview + CI
9. you REVIEW and MERGE ───────────────────────────────► production deploy
10. tear down sandbox ────►  VM discarded
```

Steps 2–7 are the new capability (all in the VM; nothing touches production
data). Step 9 is unchanged — **your merge is the only path to production.**

## 4. The build — layers

### Layer A — the sandbox runtime (decided: `@vercel/sandbox`)
- **Provider: `@vercel/sandbox`** — isolated Linux microVM, writable fs, package
  install, git, snapshots, launchable straight from the existing Vercel app.
  Chosen over a GitHub-Actions-hosted agent because it lets us run the app in-VM
  and stream a live preview; chosen over generic container/E2B backends because
  it's the tightest fit with the app already on Vercel.
- **A `lib/sandbox/` seam** that owns: create, run-command, read/write-file,
  snapshot, teardown, with a hard **wall-clock + cost ceiling** per session and a
  **concurrency cap of 1** per user (a dev loop is interactive, not fan-out).
- **A base snapshot** with Node + deps pre-installed (from `npm ci`) and, if we
  want the app actually runnable in-VM, Docker + Supabase CLI per `AGENTS.md`.
  The snapshot is the difference between a multi-minute and a seconds-scale start.

### Layer B — the coding agent inside the VM (decided: Claude Code, headless)
- **Decision:** launch **Claude Code in headless mode** inside the VM as the
  engineer, rather than hand-rolling an agent loop or driving edits token-by-token
  from Chief's own turn. Chief orchestrates (understands the ask + screen, sets
  permissions, presents results); Claude Code reads, edits, runs, and fixes.
- **How:** follow Vercel's *"Vercel Sandbox + Claude Agent SDK"* guide; adapt the
  *Coding Agent Platform* template (which is engine-selectable, so Codex / Cursor
  / Gemini / opencode stay open as later options behind the same seam). Drive
  Claude Code with `claude -p --output-format stream-json`, a turn limit, and
  `--allowedTools` scoped to the checkout.
- **The write gate is unchanged.** Claude Code runs shell in a throwaway VM, so
  its edits/commands are *not* production writes — they can run under a
  sandbox-scoped allowlist (no writes outside the checkout, egress limited to the
  package registry + the repo). The only gated action remains the **PR**, and the
  only path to production remains **your merge**.

### Layer C — self-verify
- Reuse the loop the repo already prescribes: `npm run typecheck`,
  `npm run release:check`, the focused `test:*` suites, and — if the VM runs the
  app — `npm run dev` + `check_routes`-style probes against `localhost:3000`,
  optionally one screenshot of the changed screen (honoring `AGENTS.md`: concise
  final-state screenshots, no walkthrough recordings).
- Chief reports **only after green**, exactly like the current
  "never call a PR ready before you've seen it go green" rule — except now the
  first green happens in the VM, before the PR.

### Layer D — the PR hand-off
- No new code path: Chief takes the diff it produced in the VM and proposes it
  through the existing `create_branch` / `push_files` / `create_pull_request`
  cards. The VM is the *author*; GitHub remains the source of truth and the
  review surface. VM is torn down after the push.

## 5. Honest costs / risks

- **Cost + latency.** A microVM per dev session is real money and a cold-start
  tax; the base snapshot and a strict per-session ceiling are mandatory, not
  nice-to-have.
- **Secrets in the VM.** Running the app in-VM wants Supabase keys and possibly
  an AI key. Prefer the **fixed local demo keys** from `AGENTS.md` (no real
  secret leaves Vault) and only inject real credentials if a task truly needs
  them — each injected secret is a new exposure surface inside a VM that ran
  model-chosen commands.
- **The `sb_exec` blast radius.** Auto-running shell in a VM is the whole point,
  but it's also the new trust surface. Contain it: ephemeral VM, no inbound
  network beyond package registries + the repo, an allowlist/denylist on
  commands, and it can *never* reach production data or push without the gated
  card.
- **It does not remove the human merge**, and shouldn't. This buys a better
  *author*, not an autonomous deployer.

## 6. Why this is a Sovereign feature by nature (not a compromise)

An early worry was that a sandbox "crosses the sovereignty line" or makes Chief
Cloud harder. On inspection it does neither — because self-editing only makes
sense in the Sovereign edition in the first place. Two things were being
conflated:

- **Data sovereignty is not implicated.** Sovereignty in Chief (`CLOUD.md`) is
  about *user data, AI billing, approvals, and exit*. The sandbox operates on
  **code** — it clones the repo, edits files, opens a PR. It never needs to touch
  the user's Supabase data. So the "you own your data / we can't see it" promise
  is untouched.
- **The only real variable is whose computer runs the box** — and that splits
  cleanly by edition:

| | Sovereign (one deploy per user) | Cloud (one app, N tenants) |
| --- | --- | --- |
| Whose Vercel account runs the sandbox | **the user's own** | the operator's |
| Whose code it edits | the user's own deployment | one **shared** codebase |
| Who pays for the VM | the user | the operator |

Under **Sovereign**, every column is the user's: their box, their code, their
bill, their trust boundary. Chief launching a Vercel Sandbox there is just "the
user's own workshop on the user's own account." Nothing crosses any line — this
is the *ideal* home for the feature.

Under **Cloud** it isn't a cost problem so much as a **category error**: the
Cloud target (`CLOUD-PLAN.md` §2) is *"one multi-tenant hosted app… we ship
code/updates once."* There is one shared codebase for all tenants, so "tenant A
edits the app" has nowhere coherent to land — it would either deploy to the
shared app and hit *everyone*, or require per-tenant forks that destroy the
"ship once" model. In Cloud, updates flow **from the operator, centrally**; a
tenant self-editing the shared runtime is not something we want to offer.

**Conclusion:** self-editing is a **Sovereign feature, full stop.** We do *not*
offer the sandbox loop to Cloud tenants, so the "operator runs N untrusted VMs"
cost/security surface never materializes. "Sovereign-only" is the correct scope,
not a hedge. (If per-tenant self-editing under Cloud is ever wanted, it needs
per-tenant fork infrastructure regardless of sandboxes — a separate, much larger
product decision.)

## 7. Suggested phasing

- **Phase 1 — the seam + a provisioning spike.** `lib/sandbox/` create / run /
  teardown against `@vercel/sandbox`, a base snapshot, and hard cost/time
  ceilings. Prove it end to end with a trivial job (clone the repo, run
  `npm run typecheck`, return the result), *Sovereign-only and behind a setting*,
  before wiring any agent. Establishes the real per-session cost and cold-start
  numbers. **Note:** this phase can only be truly verified on a live Vercel
  deploy (the sandbox needs the Vercel runtime + token); expect to validate on a
  preview, not in CI/typecheck alone.
- **Phase 2 — launch Claude Code in the VM.** Install Claude Code + the Agent SDK
  per Vercel's guide; run `claude -p` headless against the checkout with a turn
  limit and a scoped `--allowedTools`, streaming its progress. It edits, runs
  `typecheck` / tests, and opens the PR. Chief presents the diff + result in chat.
- **Phase 3 — run + self-verify + live preview.** Docker + Supabase (local demo
  keys per `AGENTS.md`), `npm run dev` in-VM, route probes, and stream a live
  preview / screenshot back into Chief's chat. Wire the "Update this app" entry to
  this loop; keep the existing GitHub MCP loop as the fallback during transition.
- **Phase 4 — engine selectability (optional).** The template already abstracts
  the engine; expose Codex / Cursor / Gemini / opencode as alternates behind the
  `lib/sandbox/` seam only if there's demand.

## 8. Trust / `TRUST.md` implications

- New capability: Chief runs shell in an **ephemeral, isolated** VM that holds a
  clone of the repo. No production data, no unattended production write; the PR +
  human merge gate is unchanged.
- New sensitive surfaces: the sandbox credential and any real secret injected
  into a VM — Vault, write-only, out of model context, and prefer the local demo
  keys so no real secret enters the VM at all.
- Screenshots/logs from the VM may capture app content; retain/clean them like
  the existing preview-inspection path.

## 9. Open questions — mostly resolved (2026-07-20)

1. **O1 — provider:** ✅ **`@vercel/sandbox`.** Real per-session cost and
   cold-start numbers (with a warm snapshot) still to be measured in Phase 1.
2. **O2 — in-VM agent:** ✅ **Claude Code, headless** (engine-selectable later via
   the template's abstraction). Superseded the earlier "thin tools" lean.
3. **O3 — how much to run in-VM:** *open.* Typecheck + tests only (cheap, no
   secrets) for Phase 2, then the full app via Supabase **local demo keys**
   (`AGENTS.md`) in Phase 3. Confirm the demo-key path covers enough before
   injecting any real secret.
4. **O4 — Cloud:** ✅ **Sovereign-only, by nature** (§6) — not revisited unless
   per-tenant self-editing becomes a real product ask.
5. **O5 — autonomy line:** ✅ **stop at "open a PR, you merge"** — same as
   `DEVLOOP-PLAN.md` §10.4 and `DEVMODE-PLAN.md` §8.4.
