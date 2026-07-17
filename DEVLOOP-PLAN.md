# Chief dev-loop — build plan (for review)

Status: **proposal, under review.** Companion to `CLOUD-PLAN.md`. This is the
plan for letting Chief **update its own app** through a GitHub + Vercel loop,
with in-app browser inspection of the resulting preview. Written to stand on its
own so it can be handed to another reviewer.

## 0. What was asked

> Connect GitHub and Vercel to Chief via Pipedream. Let Chief update the app
> directly. The real flow: Chief pushes a branch → Vercel builds a preview →
> Chief checks deployment status, build logs, runtime errors, key routes, and
> response timing → a **browser tool** opens the preview, clicks through the
> changed area, screenshots it, catches console errors, and confirms the UI. If
> previews are protected, use Vercel's automation **bypass secret**.

Two scoping decisions already taken (this doc reflects them):

- **Deliverable now = this written plan**, not code.
- **The browser dev-loop runs _inside the hosted app_** (not in a separate
  coding-agent environment).

## 1. What already exists (so we don't rebuild it)

Chief is further along toward this than it looks. The loop reuses four seams
that are already in the codebase:

- **Connectors are remote MCP servers.** Any app connected through Pipedream
  Connect (or a direct MCP URL under Advanced) becomes an app/account-scoped MCP
  session whose tools appear in Chief chat — see `lib/mcp-connections.ts`,
  `lib/pipedream-mcp-config.ts`. **GitHub and Vercel need no new connection
  code**; connecting them is a runtime step in Settings → Connections. This
  plan's code is everything _around_ that connection, not the connection itself.
- **The read/write gate is annotation-driven.** `lib/mcp-broker.ts` classifies a
  connector tool as read-only only when its MCP `readOnlyHint` is set and
  `destructiveHint` is not; everything else is a write. Reads can auto-run;
  **every write, send, or delete goes through the approve-first card** and only
  `POST /api/actions/execute` ever performs it (`lib/actions.ts` header comment).
  This is the "Chief proposes; you approve" contract and the plan must not
  weaken it.
- **There is an editorial polish seam for connector tools.**
  `lib/tool-enrichments.ts` ships an **empty registry** today. It lets us attach
  a human label, a tier (`yellow` reversible / `red` irreversible), an input
  schema, and an approval-card preview to a specific `(app, tool)` — _editorial
  only, never authorization_ (gating is always re-derived live). This is exactly
  where GitHub/Vercel write tools get their good cards.
- **Native read tools + chat attachments already have a home.**
  `CHIEF_READ_TOOLS` in `lib/chief-read-tools.ts` is the pattern for a
  transparent, RLS-scoped, auto-running read tool; `lib/chief-attachments.ts` /
  `lib/chat-attachments.ts` already carry images into a Chief turn. Deploy-health
  checks and browser screenshots slot in as new read tools that return text +
  image attachments.
- **A self-update path already ships.** Upstream changes open PRs into the
  user's repo and merging deploys via Vercel (`.github/workflows/upstream-updates.yml`,
  `lib/updater-workflow.ts`, Config → Software updates). "Chief updates the app"
  should ride this rail, not invent a second one.

## 2. The loop, end to end

```
Chief (chat)                     GitHub (MCP)        Vercel                     Hosted app
─────────────                    ────────────        ──────                     ──────────
1. propose branch + file edits ─► create_branch,
                                  push_files          (approval card each)
2. propose "open PR" ──────────► create_pull_request
3. PR opens ───────────────────────────────────────► auto-builds preview
4. read deploy health ◄──────────────────────────── get_deployment / build logs / runtime errors
   (auto-run read tools)                              key routes via fetch + timing
5. inspect the preview ─────────────────────────────────────────────────────► /api/preview/inspect
                                                                                (serverless Chromium:
                                                                                 open, click, screenshot,
                                                                                 collect console errors)
6. report: status + screenshots + console log + timings, back in chat
7. you review the PR and MERGE ─────────────────────► production deploy
```

Steps 1–2 and 7 are **gated writes / a human merge** — that is the approval
surface. Steps 4–5 are **auto-running reads**. Chief never merges to production
on its own; it proposes a PR and you merge, which is identical to today's
update flow.

## 3. Layer 1 — connect the apps (runtime config, ~no code)

- **GitHub** and **Vercel** both exist as Pipedream connectors. The owner
  authorizes each account through the hosted Connect Link exactly like any other
  Pipedream app; each becomes its own MCP session.
- Alternatively, connect Vercel's / GitHub's **first-party MCP servers** under
  Advanced · Direct MCP if we prefer their native tools to the Pipedream
  registry. (Both surfaced in this session's tool list, so a hosted MCP exists
  for each — worth comparing tool coverage before committing to Pipedream vs
  first-party.)
- **Code cost:** documentation only — a Connections section in `README.md` and
  `pipedream/README.md` describing which scopes to grant and the two-connector
  setup. **Open question O1** below covers Pipedream vs first-party MCP.

## 4. Layer 2 — deploy-health read tools

New native, auto-running, read-only tools registered alongside `CHIEF_READ_TOOLS`
(or a sibling `CHIEF_DEPLOY_TOOLS` array wired the same way in
`app/api/chief/route.ts`). Each returns compact text Chief can reason over:

- `deployment_status(ref?)` — latest deployment for the connected project /
  branch: state (BUILDING/READY/ERROR), URL, commit, timestamps.
- `build_logs(deployment_id)` — clipped build log tail, error lines first.
- `runtime_errors(deployment_id)` — recent runtime errors/logs for the preview.
- `check_routes(paths[])` — `fetch` each key route on the preview URL and report
  status code + **timing** (TTFB + total; a full DNS/TCP/TLS `httpstat`
  breakdown isn't reliably available from the serverless runtime — we capture
  what we _can_ measure honestly and label it as such).

Data source: either the connected **Vercel MCP** read tools (preferred — reuses
the gate and the credential already in Vault) or Vercel's REST API with a token
in Vault. Reads are safe and auto-run; nothing here writes.

## 5. Layer 3 — browser inspection **inside the hosted app** (the hard part)

This is the real architectural addition and the part chosen to live in the app
itself. Design:

- **A serverless inspection route** `POST /api/preview/inspect` running headless
  Chromium in the Node serverless runtime via `playwright-core` +
  `@sparticuz/chromium` (the standard "Chromium on Vercel" packaging; ~50 MB,
  fits the function bundle). Input: preview URL, an ordered list of steps
  (`goto` / `click` / `expectText`), and the target selector(s) to screenshot.
- **What it returns:** per-step pass/fail, a **screenshot** of the changed area,
  the collected **console + `pageerror` stream** (captured via
  `page.on("console")` / `page.on("pageerror")`), and the final URL. Screenshots
  are written to a **Supabase Storage** bucket (RLS-scoped to the user) and
  handed back into the Chief turn as image attachments through the existing
  `lib/chief-attachments.ts` path — so they render in chat with no new UI.
- **Exposed to Chief as a read tool** `inspect_preview(url, steps, screenshot_of)`
  — read-only and auto-running (it never mutates the user's data; it only looks
  at a preview). It respects `AGENTS.md`'s "concise screenshots of the final
  rendered state, no walkthrough recordings" rule.
- **Honest cost / constraints** (this is why it's the fork in the road):
  - Cold starts and the function **max-duration** ceiling (short on Hobby; needs
    Pro/Fluid compute for multi-step click-throughs). A long walkthrough may need
    to be split across calls.
  - A headless browser in the request path is heavy; concurrency should be capped
    and long runs backgrounded.
  - **Multi-tenant (Chief Cloud, see `CLOUD-PLAN.md`) makes this worse** — running
    N users' browsers on operator infra is a real cost/security surface. Under
    Sovereign (one deployment per user) it's contained.
- **Lower-lift alternative (O2):** connect a **hosted browser as an MCP server**
  (e.g. a Browserbase-style browser MCP) under Direct MCP, instead of packaging
  Chromium into our own function. It reuses the connection + gate model wholesale,
  offloads the browser runtime, and needs almost no new app code — at the price of
  another external dependency and credential. Recommend building the native route
  only if we specifically want the browser _inside_ our trust boundary; otherwise
  the browser-MCP path is materially cheaper.

## 6. Layer 4 — "Chief updates the app" write path

The write tools come from the connected **GitHub** MCP (`create_branch`,
`push_files` / `create_or_update_file`, `create_pull_request`, …). They flow
through the broker as gated proposals; we **enrich** the important ones in
`lib/tool-enrichments.ts` so the approval cards read well:

- `create_pull_request` → `yellow` (reversible): preview shows title, base←head,
  and a file list.
- `create_branch`, `push_files` → `yellow`: preview shows branch + changed paths.
- Anything that writes to the **default branch / triggers a production deploy**
  → `red` (irreversible, slide-to-confirm, never batched), or disallowed
  entirely via a tool override set to `ask`/`off`.

**Invariant:** Chief opens a PR (a proposal); **the human merges** (the
approval); Vercel deploys the merge. This is the same shape as the existing
updater flow and keeps the trust contract intact — no new "autonomous deploy"
path is introduced.

## 7. Vercel protected previews — the bypass secret

Preview deployments are usually behind Vercel's Deployment Protection. Both the
deploy-health route checks (Layer 2) and the browser inspector (Layer 3) must
reach them:

- Store the project's **Automation Bypass Secret** in Supabase Vault (same
  write-only pattern as other connector secrets in `lib/mcp-connections.ts`),
  surfaced in Settings.
- `check_routes` sends it as the `x-vercel-protection-bypass` header;
  `inspect_preview` sets the same header (and `x-vercel-set-bypass-cookie=true`
  so the browser keeps access across in-page navigations).
- The secret is never placed in model context — the route reads it server-side,
  exactly like every other credential.

## 8. Trust / `TRUST.md` implications

- New capability: Chief can propose repo writes and read deployment internals.
  All repo writes stay gated; production still requires a human merge. Document
  this plainly.
- The bypass secret and any Vercel/GitHub token are new sensitive assets — Vault,
  write-only, out of model context.
- Screenshots may capture app content; they live in the user's own Supabase
  Storage under RLS. State retention/cleanup.

## 9. Suggested phasing

- **Phase 1 —** connect GitHub + Vercel (docs); enrich the GitHub write tools
  in `lib/tool-enrichments.ts`; ride the existing PR/merge/update rail. _Low
  risk, ships the "Chief opens a PR you merge" loop with no new infra._
- **Phase 2 —** deploy-health read tools (Layer 2) + bypass-secret handling
  (Layer 7). _Read-only, auto-running; makes Chief useful about deployments._
- **Phase 3 —** browser inspection (Layer 3): decide native serverless Chromium
  vs browser-MCP (O2), then build the chosen path + screenshot attachments.
  _The heavy phase; gate it behind the O2 decision._
- **Phase 4 —** tighten the write path: red-tier / overrides for
  production-touching tools, and fold the loop into Config → Software updates.

## 10. Open questions for review

1. **O1 — Pipedream vs first-party MCP** for GitHub and Vercel: which gives the
   tool coverage we need (branch/PR writes; deployment/build-log/runtime-error
   reads) with the least setup friction?
2. **O2 — browser runtime**: native serverless Chromium _inside_ the app (in our
   trust boundary, but heavy on Vercel and much heavier under Cloud), or a hosted
   **browser MCP** connection (cheap, reuses the gate, adds a dependency)? This is
   the biggest decision and gates Phase 3.
3. **Function limits**: are we on a Vercel plan whose max-duration/Fluid-compute
   supports multi-step click-throughs, or must inspection be single-step and
   backgrounded?
4. **Autonomy line**: is "Chief opens a PR, human merges" the right stopping
   point, or do we ever want Chief to merge/deploy behind a `red` slide-to-confirm
   card? (Recommendation: stop at PR; never auto-merge to production.)
5. **Cloud interaction**: does the browser-in-app design survive the multi-tenant
   pivot in `CLOUD-PLAN.md`, or should browser inspection be Sovereign-only?
