// Optional curated polish for specific connector (broker) write tools: a
// hand-built label, tier, input schema, and preview keyed by (app, tool). When
// present, the chief route swaps in the schema and pins the tool (always
// attached, exempt from the per-turn cap), and toMcpProposal uses the
// label/tier/preview; when absent, the tool falls through to generic broker
// treatment (safe-default "irreversible" tier + raw arg dump preview).
//
// Enrichment is EDITORIAL ONLY — never authorization. Read/write gating is
// always re-derived live from MCP annotations, and an approved enriched write
// runs through the same server-keyed broker path as any other connector write.
//
// The registry ships empty; entries get added as specific connectors earn
// polish (e.g. a calendar event card with a proper date preview).

import type Anthropic from "@anthropic-ai/sdk";
import type { McpServerConfig } from "@/lib/mcp";
import type { McpToolDef } from "@/lib/mcp-broker";
import type { ActionTier } from "@/lib/actions";

export type ToolEnrichment = {
  /** App slug this applies to (matches server.app, falling back to server.name). */
  app: string;
  /** Bare tool name on the server (before any toolPrefix). */
  tool: string;
  /** Human label for the approval card. */
  label: string;
  /** Card tier: "yellow" = standard/reversible, "red" = irreversible. */
  tier: ActionTier;
  /** Optional replacement description shown to the model. */
  description?: string;
  /** Optional replacement input schema shown to the model. */
  input_schema?: Anthropic.Tool["input_schema"];
  /** Human-readable preview of the exact effect, for the approval card. */
  preview?: (args: Record<string, unknown>) => string;
};

// Clip a long value so a card preview stays legible.
const clip = (v: unknown, n = 200): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

const repoRef = (a: Record<string, unknown>): string =>
  a.owner && a.repo ? `${String(a.owner)}/${String(a.repo)}` : String(a.repo ?? "");

// Curated cards for GitHub's official remote MCP write tools — the branch/commit/
// PR steps of Chief's push → preview → verify loop. These apply when GitHub is
// connected under Advanced · Direct MCP with the connection's App field set to
// `github` (so server.app === "github"); otherwise the tools fall through to the
// generic broker card. Every one still runs through the same approve-first gate
// and the read/write classification is re-derived live — enrichment is editorial
// only. Opening a PR / pushing to a feature branch is reversible (yellow); the
// deploy-to-production step is a human merge on GitHub, never a Chief tool call.
const GITHUB_ENRICHMENTS: ToolEnrichment[] = [
  {
    app: "github",
    tool: "create_branch",
    label: "Create branch",
    tier: "yellow",
    preview: (a) => {
      const from = a.from_branch ? ` from ${String(a.from_branch)}` : "";
      return `New branch ${String(a.branch ?? "")}${from} in ${repoRef(a)} (reversible).`;
    },
  },
  {
    app: "github",
    tool: "create_or_update_file",
    label: "Commit file",
    tier: "yellow",
    preview: (a) =>
      [
        `Commit ${String(a.path ?? "")} on ${String(a.branch ?? "")} in ${repoRef(a)}`,
        a.message ? `\nmessage: ${clip(a.message, 120)}` : "",
      ]
        .filter(Boolean)
        .join(""),
  },
  {
    app: "github",
    tool: "push_files",
    label: "Push files",
    tier: "yellow",
    preview: (a) => {
      const files = Array.isArray(a.files)
        ? (a.files as { path?: unknown }[]).map((f) => String(f?.path ?? "")).filter(Boolean)
        : [];
      const list = files.length
        ? `\n${files.slice(0, 8).join("\n")}${files.length > 8 ? `\n…(+${files.length - 8} more)` : ""}`
        : "";
      return [
        `Push ${files.length || "?"} file(s) to ${String(a.branch ?? "")} in ${repoRef(a)}`,
        a.message ? `\nmessage: ${clip(a.message, 120)}` : "",
        list,
      ]
        .filter(Boolean)
        .join("");
    },
  },
  {
    app: "github",
    tool: "create_pull_request",
    label: "Open pull request",
    tier: "yellow",
    preview: (a) => {
      const flow =
        a.head && a.base ? `${String(a.head)} → ${String(a.base)}` : "";
      return [
        `Open PR in ${repoRef(a)}${a.draft ? " (draft)" : ""}`,
        a.title ? `\n${String(a.title)}` : "",
        flow ? `\n${flow}` : "",
        a.body ? `\n\n${clip(a.body, 240)}` : "",
      ]
        .filter(Boolean)
        .join("");
    },
  },
];

const ENRICHMENTS: ToolEnrichment[] = [...GITHUB_ENRICHMENTS];

/** Look up the curated enrichment for a server's tool, if one exists. */
export function findEnrichment(
  server: McpServerConfig,
  toolName: string,
): ToolEnrichment | undefined {
  const bareTool =
    server.toolPrefix && toolName.startsWith(server.toolPrefix)
      ? toolName.slice(server.toolPrefix.length)
      : toolName;
  // Match the app slug case-insensitively: a connection whose App field is
  // "GitHub" must get the same "github" cards as one set to "github" (otherwise
  // the capability turns on but the curated cards silently drop).
  const app = (server.app ?? server.name).toLowerCase();
  return ENRICHMENTS.find((e) => e.app.toLowerCase() === app && e.tool === bareTool);
}

/** Apply an enrichment's model-facing polish (description/schema) to a broker
 *  tool definition. The read/write classification is never touched. */
export function applyEnrichment(
  def: McpToolDef,
  enrichment: ToolEnrichment | undefined,
): McpToolDef {
  if (!enrichment) return def;
  return {
    ...def,
    description: enrichment.description ?? def.description,
    inputSchema:
      (enrichment.input_schema as Record<string, unknown> | undefined) ??
      def.inputSchema,
  };
}
