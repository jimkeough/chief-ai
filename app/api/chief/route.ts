import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import { getAuthed } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { resolveAi, describeAiError, isRetryableAiError } from "@/lib/ai";
import { buildChiefSystemPrompt, type ChiefPageContext } from "@/lib/chief";
import { getMcpServers, type McpServerConfig } from "@/lib/mcp";
import { listMcpTools, callMcpTool, type McpToolDef } from "@/lib/mcp-broker";
import { findEnrichment, applyEnrichment } from "@/lib/tool-enrichments";
import { getToolOverrides, effectiveMode } from "@/lib/tool-overrides";
import { recordCommunication } from "@/lib/communications";
import {
  PROPOSALS_MARKER,
  getWriteAction,
  isEmptyUpdate,
  toProposedAction,
  toMcpProposal,
  nameProjectProposals,
  writeActionTools,
  type ProposedAction,
} from "@/lib/actions";
import {
  CHIEF_READ_TOOLS,
  isChiefReadTool,
  runChiefReadTool,
} from "@/lib/chief-read-tools";
import { KB_TOOLS, makeKbToolRunner } from "@/lib/kb/tools";
import { findRelatedKbEntries } from "@/lib/kb/related";
import { listProjects } from "@/lib/projects";
import { applyAttachments, type ChatAttachment } from "@/lib/chat-attachments";
import { loadChiefAttachments } from "@/lib/chief-attachments";
import { getDeployTarget } from "@/lib/deploy-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Chief streams a multi-turn tool loop (model turns + connector/MCP round-trips),
// so it needs a real budget — without this it inherited the short platform
// default and got killed mid-stream, which surfaces to the client as a bare
// "network error". 60s is the Hobby ceiling and matches the other model-loop
// routes (import, inbox). Dev mode (reading repo files over the GitHub MCP) is
// the heaviest case and the one that was timing out.
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 6;

// Transient gateway/provider errors (429/5xx/overloaded) are retried with
// exponential backoff — but only before any text has streamed for the turn,
// since we can't un-send bytes already on the wire.
const MAX_AI_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// POST /api/chief -> stream Chief's reply over the user's whole workspace,
// grounded in what they're currently looking at (the page context).
//
// Chief is brokered onto every configured MCP server: read-only tools run
// transparently in the loop so it can ground its advice in live data, and
// write tools — plus the registered write actions — are caught here and
// streamed back as approve/reject proposals. We NEVER execute a write here;
// that's the human-in-the-loop gate (the user approves and
// /api/actions/execute performs it). Default-deny throughout.
export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return new Response("Not signed in.", { status: 401 });

  const settings = await getAppSettings();
  const ai = await resolveAi({ settings });
  if (!ai)
    return new Response(
      "Chief has no AI credential. On Vercel: enable Settings → Security → Secure Backend Access so the AI Gateway OIDC token is issued (the sovereign default, no key needed). Or set an explicit credential — paste an AI Gateway key in Config, or set ANTHROPIC_API_KEY and switch Config → AI — provider to \"anthropic\".",
      { status: 500 },
    );
  const model = ai.model;

  const mcpEnabled = settings["mcp.chat_enabled"].trim().toLowerCase() === "on";
  if (!mcpEnabled) {
    return new Response("Chief is currently turned off.", { status: 503 });
  }
  // Proposals + connector writes are writes — gated by the master switch AND
  // the write switch.
  const actionsEnabled = settings["actions.enabled"].trim().toLowerCase() === "on";
  // Native server-side web reading (read-only; only fetches URLs already in
  // the conversation). Governed by its own switch.
  const webFetchEnabled =
    settings["web.fetch_enabled"].trim().toLowerCase() === "on";

  const { messages, page, attachments, attachmentIds, sessionId, mode } =
    (await req.json().catch(() => ({}))) as {
      messages?: ChatMessage[];
      page?: ChiefPageContext | null;
      attachments?: ChatAttachment[];
      attachmentIds?: string[];
      sessionId?: string | null;
      mode?: string;
    };
  // Dev mode: the "Update this app" entry. Loads the engineer persona and
  // narrows the toolset to the app-editing apps (GitHub/Vercel/Supabase).
  const devMode = mode === "dev";
  let resolvedAttachments = Array.isArray(attachments) ? attachments : [];
  if (Array.isArray(attachmentIds) && attachmentIds.length > 0) {
    try {
      resolvedAttachments = await loadChiefAttachments(attachmentIds);
    } catch (error) {
      return new Response(
        error instanceof Error ? error.message : "Could not load documents.",
        { status: 400 },
      );
    }
  }

  // Exfiltration guard (build-brief security rule 2): when the page context or
  // an uploaded file embeds external content, open-world READ tools must not be
  // attached in the same turn — a read call with model-chosen arguments is an
  // exfiltration channel. Chief can still summarize and propose from the
  // workspace snapshot; connector reads happen on a clean follow-up turn.
  const hasAttachments =
    resolvedAttachments.length > 0;
  const untrustedTurn = page?.untrusted === true || hasAttachments;

  // Broker every configured server plus built-in official Gmail and Front MCP.
  // Built-ins win name/app collisions so a stale Pipedream Front connection
  // cannot shadow the user-authorized official Front server.
  let brokerServers: McpServerConfig[] = [];
  if (!untrustedTurn) {
    brokerServers = (await getMcpServers()).filter((s) => s.name !== "gmail");
    const gmail = await (await import("@/lib/gmail")).gmailMcpServer().catch(() => null);
    if (gmail) brokerServers.push(gmail);
    const { frontMcpServer, isFrontServer } = await import("@/lib/front-mcp");
    const front = await frontMcpServer().catch(() => null);
    if (front) {
      brokerServers = brokerServers.filter((server) => !isFrontServer(server));
      brokerServers.push(front);
    }
    // Dev mode narrows the connected apps to the ones that edit/inspect the app
    // itself — GitHub (repo reads + gated writes), Vercel and Supabase (reads).
    // The rest (Gmail, Front, calendars, CRM…) are noise for a code change.
    if (devMode) {
      const DEV_APPS = new Set(["github", "vercel", "supabase"]);
      brokerServers = brokerServers.filter((s) =>
        DEV_APPS.has((s.app ?? s.name).toLowerCase()),
      );
    }
  }

  const brokerReads: { server: McpServerConfig; def: McpToolDef }[] = [];
  const brokerWrites: { server: McpServerConfig; def: McpToolDef }[] = [];
  if (brokerServers.length > 0) {
    // Reserve the static action + read-tool names so a connector tool can't
    // shadow them.
    const taken = new Set<string>([
      ...writeActionTools().map((t) => t.name),
      ...CHIEF_READ_TOOLS.map((t) => t.name),
      ...KB_TOOLS.map((t) => t.name),
    ]);
    // Chief is meant to read across ALL connected apps, so the per-turn tool
    // budget is generous (and tunable). It's still capped to keep input tokens
    // bounded — the tool schemas are prompt-cached after the first turn.
    const capRaw = Number.parseInt(settings["connectors.max_chief_tools"], 10);
    const MAX_BROKER_TOOLS = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : 150;
    // Discover every server's tools in parallel, then split each server's tools
    // into read/write queues (dedup by name, in stable server order). Read/write
    // is decided live from def.readOnly — the gate never consults enrichments.
    const perServer = await Promise.all(
      brokerServers.map((s) =>
        listMcpTools(s)
          .then((defs) => ({ s, defs }))
          .catch(() => ({ s, defs: [] as McpToolDef[] })),
      ),
    );
    type Entry = { server: McpServerConfig; def: McpToolDef };
    // The user's per-tool dial: off = never attached; ask = a read demoted to
    // the approval card; auto = default for annotated reads only. Writes can
    // never come out auto (effectiveMode re-derives from live annotations).
    const overrides = await getToolOverrides().catch(() => ({} as import("@/lib/tool-overrides").ToolOverrides));
    const readQ: Entry[][] = [];
    const writeQ: Entry[][] = [];
    for (const { s, defs } of perServer) {
      const reads: Entry[] = [];
      const writes: Entry[] = [];
      for (const def of defs) {
        if (taken.has(def.name)) continue;
        const mode = effectiveMode(def.readOnly, overrides[s.name]?.[def.name]);
        if (mode === "off") continue;
        taken.add(def.name);
        const enrichment = findEnrichment(s, def.name);
        const enriched = applyEnrichment(def, enrichment);
        if (mode === "auto") {
          reads.push({ server: s, def: enriched });
        } else if (actionsEnabled) {
          // Pin curated (enriched) writes — attach now, exempt from the
          // round-robin cap below, so they stay always-available.
          if (enrichment) brokerWrites.push({ server: s, def: enriched });
          else writes.push({ server: s, def: enriched });
        }
      }
      readQ.push(reads);
      writeQ.push(writes);
    }
    // Fill the budget ROUND-ROBIN across servers — reads first (so "read
    // everything" is honored across every app), then writes — so one tool-heavy
    // connector (e.g. GitHub) can't starve the others of their tools.
    const total = () => brokerReads.length + brokerWrites.length;
    const drain = (queues: Entry[][], into: Entry[]) => {
      let progress = true;
      while (progress && total() < MAX_BROKER_TOOLS) {
        progress = false;
        for (const q of queues) {
          if (q.length === 0) continue;
          if (total() >= MAX_BROKER_TOOLS) break;
          into.push(q.shift()!);
          progress = true;
        }
      }
    };
    drain(readQ, brokerReads);
    drain(writeQ, brokerWrites);
  }
  const brokerReadByName = new Map(brokerReads.map((t) => [t.def.name, t.server]));
  const brokerWriteByName = new Map(
    brokerWrites.map((t) => [t.def.name, t.server]),
  );
  const brokerToolDefs: Anthropic.Tool[] = [...brokerReads, ...brokerWrites].map(
    (t) => ({
      name: t.def.name,
      description: t.def.description,
      input_schema: t.def.inputSchema as Anthropic.Tool["input_schema"],
    }),
  );

  // Human-readable app names for the system prompt. Servers with multiple
  // accounts carry their account label so Chief can target the right one.
  const displayName = (s: McpServerConfig) => {
    const base = s.app ?? s.name;
    return s.accountLabel ? `${base} (${s.accountLabel})` : base;
  };
  const connectedApps = brokerServers.map(displayName);
  const gatedServerNames = [
    ...new Set(brokerWrites.map((w) => displayName(w.server))),
  ];
  // Is GitHub connected this turn? That's what makes Chief's review-gated dev
  // loop (propose branch/PR → user merges → Vercel deploys) actually available,
  // so the system prompt can tell Chief it can update its own app rather than
  // denying the capability. Matches the connection whose App/name is `github`
  // (the same value the write-tool enrichment cards key off).
  const canEditApp = brokerServers.some(
    (s) => (s.app ?? s.name).toLowerCase() === "github",
  );
  // In dev mode, resolve which repo/Vercel project this deployment edits so the
  // engineer prompt can name it exactly (auto-detected on Vercel, else the
  // devmode.repo override).
  const deployTarget = devMode ? await getDeployTarget().catch(() => null) : null;

  const system = await buildChiefSystemPrompt({
    canPropose: actionsEnabled,
    connectedApps,
    gatedServerNames,
    canEditApp,
    mode: devMode ? "dev" : "default",
    deployTarget,
    page: page ?? null,
    connectorsWithheld: untrustedTurn,
  });

  // Chief's write tools (only when writes are enabled), its read-back tools
  // (projects/tasks/KB — always available; reads are safe and let it verify
  // what's saved instead of re-proposing), plus the brokered connector tools
  // (reads always, writes when enabled).
  // In dev mode the workspace write actions (task/project/KB edits) don't apply
  // — the only writes are the gated GitHub connector tools. Keep just
  // check_routes from the native read tools (deploy sanity check); drop the
  // task/project read-backs and KB tools.
  const writeTools = actionsEnabled && !devMode ? writeActionTools() : [];
  const nativeReadTools = devMode
    ? CHIEF_READ_TOOLS.filter((t) => t.name === "check_routes")
    : CHIEF_READ_TOOLS;
  const kbTools = devMode ? [] : KB_TOOLS;
  // Anthropic's native web_fetch — server-side, returns results inline (never a
  // client tool_use block, so the dispatch loop ignores it). Placed first so it
  // stays inside the cached tool prefix. Typed loosely (the SDK's Tool union
  // may lag the _20260209 variant; the API validates it). Withheld on
  // untrusted-content turns like every open-world read.
  const serverTools =
    webFetchEnabled && !untrustedTurn
      ? ([
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
        ] as unknown as Anthropic.Tool[])
      : [];
  const clientTools = [
    ...serverTools,
    ...writeTools,
    ...nativeReadTools,
    ...kbTools,
    ...brokerToolDefs,
  ];
  const runKbTool = makeKbToolRunner();

  // Prompt caching: the tool list + system prompt are re-sent verbatim on every
  // turn of the loop and every follow-up message, so cache them as one prefix.
  const cachedClientTools: Anthropic.Tool[] = clientTools.length
    ? [
        ...clientTools.slice(0, -1),
        {
          ...clientTools[clientTools.length - 1],
          cache_control: { type: "ephemeral" },
        },
      ]
    : clientTools;
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: system, cache_control: { type: "ephemeral" } },
  ];

  const client = ai.client;
  const convo: Anthropic.MessageParam[] = (messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  // Sonnet 5 changed the default from no thinking to adaptive thinking. Chief's
  // interactive 4k response budget predates that change, and can otherwise be
  // consumed entirely by hidden thinking before any text or proposal is emitted.
  // Restore the prior low-latency behavior only for that model family; other
  // configured/fallback models keep their native request semantics.
  const thinking =
    model.includes("claude-sonnet-5") &&
    ({ type: "disabled" } satisfies Anthropic.ThinkingConfigParam);

  // Fold any uploaded document/image/text attachments into the latest user
  // turn as content blocks — Claude reads a PDF/image natively (no server-side
  // extraction). This is a client-tool turn like any other; the attachment
  // itself carries no elevated trust — see the system prompt's guidance to
  // treat its content as data, never as instructions.
  if (resolvedAttachments.length > 0) {
    applyAttachments(convo, resolvedAttachments);
  }

  // The user's message this turn, for the communications log (channel "chief" —
  // the AI chat history is a filtered view of that append-only table).
  const lastUser = [...(messages ?? [])]
    .reverse()
    .find((m) => m.role === "user");

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Everything Chief says this exchange, for the communications log.
      let assistantText = "";
      try {
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          // Retry transient failures — but only while nothing has streamed for
          // this attempt, so a retry never duplicates already-sent text.
          const textAtTurnStart = assistantText;
          let final: Anthropic.Message | undefined;
          for (let attempt = 0; ; attempt++) {
            const stream = client.messages.stream({
              model,
              max_tokens: 4096,
              ...(thinking ? { thinking } : {}),
              system: systemBlocks,
              ...(cachedClientTools.length ? { tools: cachedClientTools } : {}),
              messages: convo,
              // Gateway routing (free-model fallback + BYOK) when in gateway
              // mode. `providerOptions` is a gateway extension the SDK types
              // don't know.
              ...(ai.providerOptions
                ? { providerOptions: ai.providerOptions }
                : {}),
            } as unknown as Anthropic.MessageStreamParams);
            stream.on("text", (delta: string) => {
              assistantText += delta;
              controller.enqueue(encoder.encode(delta));
            });
            try {
              final = await stream.finalMessage();
              break;
            } catch (streamErr) {
              const emitted = assistantText !== textAtTurnStart;
              if (
                emitted ||
                attempt >= MAX_AI_RETRIES ||
                !isRetryableAiError(streamErr)
              ) {
                throw streamErr;
              }
              await sleep(500 * 2 ** attempt);
            }
          }
          if (!final) break;

          const content = final.content as Anthropic.ContentBlock[];
          const toolUses = content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          convo.push({
            role: "assistant",
            content: content as unknown as Anthropic.MessageParam["content"],
          });

          if (
            final.stop_reason === "max_tokens" &&
            toolUses.length === 0 &&
            !assistantText.trim()
          ) {
            throw new Error(
              "Chief exhausted its response budget before producing a visible answer. Please retry.",
            );
          }

          // Server-side tools (e.g. web_fetch) can pause mid-run; re-send the
          // transcript so the API resumes rather than ending the turn early.
          if (final.stop_reason === "pause_turn") continue;
          if (final.stop_reason !== "tool_use") {
            break;
          }

          // Split the calls: registered write actions and connector WRITES
          // become proposals (never executed here); reads run now and feed
          // their results back. Unknown names are default-denied.
          const proposals: ProposedAction[] = [];
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of toolUses) {
            const argsObj = (block.input ?? {}) as Record<string, unknown>;
            // Static registered write action -> proposal.
            if (getWriteAction(block.name)) {
              // A no-op update (only an id, nothing to change) isn't worth an
              // approval card — the model usually fires it trying to "show"
              // state. Tell it to read the live record instead.
              if (isEmptyUpdate(block.name, argsObj)) {
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content:
                    "That update has no changes to make. To show or confirm the current saved state, use list_projects or list_tasks — don't propose an empty update.",
                  is_error: true,
                });
                continue;
              }
              const p = toProposedAction(block.name, argsObj);
              if (p) {
                // "Save to Memory" cards also carry existing entries on the
                // same topic, so the user can merge instead of duplicating.
                // Cheap (one embedding + search) and best-effort.
                if (p.key === "save_kb_fact") {
                  p.related = await findRelatedKbEntries({
                    title: String(argsObj.title ?? ""),
                    body: String(argsObj.body ?? ""),
                  }).catch(() => []);
                }
                proposals.push(p);
              }
              continue;
            }
            // Chief read-back tool (projects/tasks) -> run now, feed result back.
            if (isChiefReadTool(block.name)) {
              try {
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: await runChiefReadTool(block.name, argsObj),
                });
              } catch (e) {
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Tool error: ${e instanceof Error ? e.message : "failed"}`,
                  is_error: true,
                });
              }
              continue;
            }
            // KB read tool (search_kb / read_kb) -> run now, feed result back.
            if (block.name === "search_kb" || block.name === "read_kb") {
              try {
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: await runKbTool(block),
                });
              } catch (e) {
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Tool error: ${e instanceof Error ? e.message : "failed"}`,
                  is_error: true,
                });
              }
              continue;
            }
            // Connector WRITE tool -> proposal (executed only on approval).
            const writeServer = brokerWriteByName.get(block.name);
            if (writeServer) {
              proposals.push(toMcpProposal(writeServer, block.name, argsObj));
              continue;
            }
            // Connector READ tool -> run it now and feed the result back.
            const readServer = brokerReadByName.get(block.name);
            if (readServer) {
              try {
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: await callMcpTool(readServer, block.name, argsObj),
                });
              } catch (e) {
                results.push({
                  type: "tool_result",
                  tool_use_id: block.id,
                  content: `Tool error: ${e instanceof Error ? e.message : "failed"}`,
                  is_error: true,
                });
              }
              continue;
            }
            // Unknown tool name -> default-deny.
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: "That tool isn't available.",
              is_error: true,
            });
          }

          // A proposed write ends the turn: emit the trailing blob for the UI
          // to render as cards. Nothing runs until the user approves it.
          if (proposals.length > 0) {
            // Lead project cards with the project name (args carry only its id).
            // Resolve names only when a project-update proposal is present, so
            // normal turns don't pay for an extra query.
            let named = proposals;
            if (
              proposals.some(
                (p) =>
                  p.key === "update_project" || p.key === "update_project_state",
              )
            ) {
              const projs = await listProjects().catch(() => []);
              const m = new Map(projs.map((pr) => [pr.id, pr.name]));
              named = nameProjectProposals(proposals, (id) => m.get(id));
            } else {
              named = nameProjectProposals(proposals, () => undefined);
            }
            controller.enqueue(
              encoder.encode(
                PROPOSALS_MARKER +
                  JSON.stringify({ proposals: named }),
              ),
            );
            break;
          }
          // Otherwise continue the loop with the read-tool results (if any).
          if (results.length === 0) {
            break;
          }
          convo.push({ role: "user", content: results });
        }

        // Logging is post-response work: a slow database must never hold the
        // text stream open after Chief has finished generating.
        const outbound = lastUser?.content.trim();
        const inbound = assistantText.trim();
        after(async () => {
          await Promise.all([
            ...(outbound
              ? [
                  recordCommunication({
                    channel: "chief",
                    direction: "out",
                    bodyText: outbound,
                    metadata: sessionId ? { chief_session_id: sessionId } : {},
                  }),
                ]
              : []),
            ...(inbound
              ? [
                  recordCommunication({
                    channel: "chief",
                    direction: "in",
                    bodyText: inbound,
                    metadata: sessionId ? { chief_session_id: sessionId } : {},
                  }),
                ]
              : []),
          ]).catch(() => {});
        });
        controller.close();
      } catch (err) {
        console.error("chief: stream failed:", err);
        // Translate opaque provider/gateway errors into an actionable sentence
        // instead of dumping the raw JSON blob into the chat.
        const detail = describeAiError(err);
        try {
          controller.enqueue(
            encoder.encode(`\n\n⚠️ Something went wrong: ${detail}`),
          );
        } catch {
          /* stream already torn down */
        }
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
