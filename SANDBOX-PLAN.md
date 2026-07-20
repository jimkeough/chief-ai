# Chief sandbox dev-environment — build plan (for review)

Status: **proposal, under review.** Companion to `DEVLOOP-PLAN.md` and
`DEVMODE-PLAN.md` (which shipped the review-gated GitHub → Vercel loop: Chief
reads the repo over the GitHub MCP, proposes a branch + commits + PR as gated
cards, you merge, Vercel deploys). This document proposes the **richer version
of that loop**: instead of editing through whole-file MCP pushes, Chief spins up
an on-demand Linux sandbox, clones the repo, edits and *runs* the code there
(typecheck, tests, dev server), and only then opens the same reviewable PR.
Written to stand on its own so it can be handed to another reviewer.

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

**Scope of this deliverable: the written plan only.** No code. Two decisions are
pre-taken to keep the plan honest:

- **The trust contract does not move.** Chief opens a PR; **you** merge; Vercel
  deploys. A sandbox changes *how Chief authors the change*, never who ships it.
- **Sovereign-first.** Build and prove this on the single-deployment (Sovereign)
  edition, where one user's VM on one user's infra is contained. Whether it ever
  graduates to multi-tenant Chief Cloud is an explicit later decision (§6), not
  assumed here.

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
Chief (dev mode)            Sandbox (microVM)              GitHub / Vercel
────────────────            ─────────────────              ───────────────
1. user asks for a change
2. spin up sandbox ───────► clone repo @ default branch
                            npm install (cached snapshot)
3. edit files directly ───► real fs: read/grep/edit freely
4. run checks ────────────► npm run typecheck
                            npm test (focused suites)
                            npm run dev + hit key routes
5. self-verify ◄─────────── pass/fail + logs + (optional) screenshot
   (if red: fix in-VM, loop 4)
6. propose PR ─────────────────────────────────────────► create_branch + push + PR
                                                          (SAME gated cards as today)
7. PR builds preview ──────────────────────────────────► Vercel preview + CI
8. you REVIEW and MERGE ───────────────────────────────► production deploy
9. tear down sandbox ─────► VM discarded
```

Steps 2–5 are the new capability (in the VM, nothing user-facing writes). Step 6
is unchanged — the existing approval cards. Steps 8 is unchanged — **your merge
is the only path to production.**

## 4. The build — layers

### Layer A — the sandbox runtime
- **Provider:** `@vercel/sandbox` is the natural first choice (isolated Linux
  microVM, writable fs, package install, git, snapshots, launchable from the
  existing Vercel app). Alternatives to weigh: a generic containers/E2B-style
  backend. Provider choice is **Open Question O1**.
- **A `lib/sandbox/` seam** that owns: create, run-command, read/write-file,
  snapshot, teardown, with a hard **wall-clock + cost ceiling** per session and a
  **concurrency cap of 1** per user (a dev loop is interactive, not fan-out).
- **A base snapshot** with Node + deps pre-installed (from `npm ci`) and, if we
  want the app actually runnable in-VM, Docker + Supabase CLI per `AGENTS.md`.
  The snapshot is the difference between a ~2-minute and a ~20-second cold start.

### Layer B — the coding agent inside the VM
- **Decision — Open Question O2:** run a full coding harness in the VM (Claude
  Code / Codex / an OSS agent) vs. drive edits from the *existing* Chief turn via
  a thin set of sandbox tools (`sb_exec`, `sb_read`, `sb_write`, `sb_grep`).
- **Lean:** start with the thin-tools path — it reuses the dev-mode persona and
  the broker/gate wholesale, and keeps *one* model in the loop (no nested-agent
  cost/opacity). Graduate to a full in-VM harness only if the thin path proves
  too chatty. Either way the **write gate is unchanged**: `sb_exec` runs in a
  throwaway VM, so it is *not* a production write and can auto-run under a
  sandbox-scoped allowlist (no `curl | sh`, no writes outside the checkout); the
  only gated write remains the GitHub PR at step 6.

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
- **Multi-tenant makes all of the above worse** — see §6.
- **It does not remove the human merge**, and shouldn't. This buys a better
  *author*, not an autonomous deployer.

## 6. Interaction with Chief Cloud (the real reason this isn't a slam dunk)

`CLOUD-PLAN.md` commits to a multi-tenant hosted future. `DEVLOOP-PLAN.md` §5
already flagged the pattern: a heavy compute runtime is *contained* under
Sovereign (one VM, one user, one bill) but under Cloud becomes "running N users'
VMs on operator infra — a real cost/security surface." A per-user microVM that
clones source, installs arbitrary deps, and runs shell is the largest version of
that worry in the codebase.

**Therefore:** ship this **Sovereign-only** first. Treat "does the sandbox loop
graduate to Cloud?" as a deliberate later decision gated on (a) observed cost per
session, (b) an isolation/abuse story for operator-hosted VMs, and (c) whether
Cloud users even need self-editing (they get auto-updates from the operator; the
whole point of Cloud is that they *don't* run their own dev loop). It is entirely
possible the right answer is "sandbox is a Sovereign power-user feature, forever."

## 7. Suggested phasing

- **Phase 1 — the seam, no agent.** `lib/sandbox/` create/exec/teardown against
  `@vercel/sandbox`, a base snapshot, cost/time ceilings, and a manual "run
  typecheck in a sandbox for this branch" spike. Proves provisioning + cost
  before any model wiring. *Sovereign-only, behind a setting.*
- **Phase 2 — thin sandbox tools in dev mode.** `sb_exec/read/write/grep` attached
  in `mode: "dev"` under the sandbox allowlist; dev prompt learns the
  clone → edit → typecheck → PR loop. Chief authors in the VM, still opens the
  same PR.
- **Phase 3 — run + self-verify in-VM.** Docker + Supabase per `AGENTS.md`,
  `npm run dev`, route probes, optional screenshot back into chat.
- **Phase 4 — decide the Cloud question (§6).** Only after real cost/isolation
  data. Default to Sovereign-only until proven otherwise.

## 8. Trust / `TRUST.md` implications

- New capability: Chief runs shell in an **ephemeral, isolated** VM that holds a
  clone of the repo. No production data, no unattended production write; the PR +
  human merge gate is unchanged.
- New sensitive surfaces: the sandbox credential and any real secret injected
  into a VM — Vault, write-only, out of model context, and prefer the local demo
  keys so no real secret enters the VM at all.
- Screenshots/logs from the VM may capture app content; retain/clean them like
  the existing preview-inspection path.

## 9. Open questions for review

1. **O1 — provider:** `@vercel/sandbox` (tightest fit with the existing Vercel
   app) vs. a generic container/E2B backend? What are the real per-session cost
   and cold-start numbers with a warm base snapshot?
2. **O2 — in-VM agent:** thin sandbox tools driven by the current Chief turn
   (recommended first) vs. a full nested coding harness in the VM? When, if ever,
   is the nested harness worth its cost/opacity?
3. **O3 — how much to run in-VM:** typecheck + tests only (cheap, no secrets), or
   the full app via Supabase (richer verify, wants keys)? Does the local
   demo-key path from `AGENTS.md` cover enough?
4. **O4 — Cloud:** does this stay Sovereign-only, or is there a real demand for
   self-editing under multi-tenant Cloud that justifies operator-hosted VMs?
5. **O5 — autonomy line:** confirm we stop at "Chief opens a PR you merge" even
   though the sandbox *could* technically merge behind a `red` slide-to-confirm.
   (Recommendation: stop at PR, same as `DEVLOOP-PLAN.md` §10.4 and
   `DEVMODE-PLAN.md` §8.4.)
