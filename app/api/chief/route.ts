import Anthropic from "@anthropic-ai/sdk";
import { getAuthed } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { resolveAi } from "@/lib/ai";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 6;

/** A Chief-suggested app connection, emitted alongside proposals. Not a gated
 *  write — connecting is inherently user-approved (the hosted OAuth screen IS
 *  the approval) — but it ends the turn and renders as a card. */
export type ConnectSuggestion = { app: string; name: string; reason: string };

// Client tool Chief calls when the user needs an app that isn't connected yet
// (only attached when Chief Connect is configured, and never on untrusted
// turns). Intercepted like a proposal; never "executed" server-side.
const SUGGEST_CONNECTION_TOOL: Anthropic.Tool = {
  name: "suggest_connection",
  description:
    "Offer the user a one-tap card to CONNECT an app they haven't linked yet (managed OAuth via Chief Connect), when what they're asking for needs it — e.g. they mention their Asana/Notion/Slack/calendar and no such connection exists in your context. Pass the app's Pipedream slug (lowercase, underscores: gmail, google_calendar, google_drive, asana, notion, slack, github, linear, trello, todoist, hubspot, jira, zoom, dropbox). Use it at most once per turn, only when the connection would genuinely serve the request, and say in one short sentence what you'll do once it's connected.",
  input_schema: {
    type: "object",
    properties: {
      app: {
        type: "string",
        description: "Pipedream app slug, e.g. \"asana\" or \"google_calendar\".",
      },
      name: { type: "string", description: "Display name, e.g. \"Asana\"." },
      reason: {
        type: "string",
        description: "One short line: why connecting helps right now.",
      },
    },
    required: ["app", "name", "reason"],
  },
};

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
      'No AI provider is configured. Set ANTHROPIC_API_KEY, or switch "ai.provider" to "gateway" in Config (a Vercel deployment authenticates the gateway automatically).',
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

  const { messages, page } = (await req.json().catch(() => ({}))) as {
    messages?: ChatMessage[];
    page?: ChiefPageContext | null;
  };

  // Exfiltration guard (build-brief security rule 2): when the page context
  // embeds external content (an email body), open-world READ tools must not be
  // attached in the same turn — a read call with model-chosen arguments is an
  // exfiltration channel. Chief can still summarize and propose; enrichment
  // reads happen on a turn without the untrusted content, or behind approval.
  const untrustedTurn = page?.untrusted === true;

  // Broker every configured server so Chief can read across all of them —
  // plus Gmail when connected (its reads are annotated read-only, so
  // search_threads/get_thread run transparently and its writes gate like any
  // other connector's). A user-configured server named "gmail" would collide,
  // so the built-in wins.
  let brokerServers: McpServerConfig[] = [];
  let connectAvailable = false;
  if (!untrustedTurn) {
    brokerServers = (await getMcpServers()).filter((s) => s.name !== "gmail");
    const gmail = await (await import("@/lib/gmail")).gmailMcpServer().catch(() => null);
    if (gmail) brokerServers.push(gmail);
    // Chief Connect (the optional hub): same broker treatment as everything
    // else. User-configured servers win on a name collision.
    const chiefConnect = await import("@/lib/chief-connect");
    connectAvailable = Boolean(
      await chiefConnect.getConnectConfig().catch(() => null),
    );
    const connect = await chiefConnect.getConnectServers().catch(() => []);
    const taken = new Set(brokerServers.map((s) => s.name));
    brokerServers.push(...connect.filter((s) => !taken.has(s.name)));
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

  const system = await buildChiefSystemPrompt({
    canPropose: actionsEnabled,
    connectedApps,
    gatedServerNames,
    page: page ?? null,
    connectorsWithheld: untrustedTurn,
    connectAvailable,
  });

  // Chief's write tools (only when writes are enabled), its read-back tools
  // (projects/tasks/KB — always available; reads are safe and let it verify
  // what's saved instead of re-proposing), plus the brokered connector tools
  // (reads always, writes when enabled).
  const writeTools = actionsEnabled ? writeActionTools() : [];
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
  // The connect-suggestion tool: only when Chief Connect is configured (there's
  // somewhere to connect through) and not on an untrusted turn.
  const connectTools =
    connectAvailable && !untrustedTurn ? [SUGGEST_CONNECTION_TOOL] : [];
  const clientTools = [
    ...serverTools,
    ...writeTools,
    ...CHIEF_READ_TOOLS,
    ...KB_TOOLS,
    ...connectTools,
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
          const stream = client.messages.stream({
            model,
            max_tokens: 4096,
            system: systemBlocks,
            ...(cachedClientTools.length ? { tools: cachedClientTools } : {}),
            messages: convo,
          });
          stream.on("text", (delta: string) => {
            assistantText += delta;
            controller.enqueue(encoder.encode(delta));
          });
          const final = await stream.finalMessage();

          const content = final.content as Anthropic.ContentBlock[];
          convo.push({
            role: "assistant",
            content: content as unknown as Anthropic.MessageParam["content"],
          });

          // Server-side tools (e.g. web_fetch) can pause mid-run; re-send the
          // transcript so the API resumes rather than ending the turn early.
          if (final.stop_reason === "pause_turn") continue;
          if (final.stop_reason !== "tool_use") break;

          const toolUses = content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          // Split the calls: registered write actions and connector WRITES
          // become proposals (never executed here); reads run now and feed
          // their results back. Unknown names are default-denied.
          const proposals: ProposedAction[] = [];
          const connectSuggestions: ConnectSuggestion[] = [];
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of toolUses) {
            const argsObj = (block.input ?? {}) as Record<string, unknown>;
            // Connect suggestion -> a "Connect X" card (not a gated write).
            if (block.name === "suggest_connection") {
              const app = String(argsObj.app ?? "").trim().toLowerCase();
              if (app) {
                connectSuggestions.push({
                  app,
                  name: String(argsObj.name ?? app).trim() || app,
                  reason: String(argsObj.reason ?? "").trim(),
                });
              }
              continue;
            }
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

          // A proposed write OR a connect suggestion ends the turn: emit the
          // trailing blob for the UI to render as cards. Nothing runs until the
          // user acts (approve → /api/actions/execute; connect → OAuth).
          if (proposals.length > 0 || connectSuggestions.length > 0) {
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
                  JSON.stringify({ proposals: named, connect: connectSuggestions }),
              ),
            );
            break;
          }
          // Otherwise continue the loop with the read-tool results (if any).
          if (results.length === 0) break;
          convo.push({ role: "user", content: results });
        }

        // Log the exchange to the append-only communications table (channel
        // "chief"): the user's message as outbound, Chief's reply as inbound.
        // Best-effort — the chat must never fail because the log did.
        if (lastUser?.content.trim()) {
          await recordCommunication({
            channel: "chief",
            direction: "out",
            bodyText: lastUser.content.trim(),
          }).catch(() => {});
        }
        if (assistantText.trim()) {
          await recordCommunication({
            channel: "chief",
            direction: "in",
            bodyText: assistantText.trim(),
          }).catch(() => {});
        }
        controller.close();
      } catch (err) {
        console.error("chief: stream failed:", err);
        const detail = err instanceof Error ? err.message : String(err);
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
