// GET /api/mcp/tools?server= — one direct MCP server's tools, classified live
// with the user's per-tool modes applied.
// POST { server, tool, mode } — set a tool's mode. Writes can be ask/off only.

import { getAuthed, unauthorized } from "@/lib/auth";
import { frontMcpServer } from "@/lib/front-mcp";
import { getMcpServers } from "@/lib/mcp";
import { listMcpTools } from "@/lib/mcp-broker";
import { gmailMcpServer } from "@/lib/gmail";
import {
  getToolOverrides,
  saveToolOverride,
  effectiveMode,
  type ToolMode,
} from "@/lib/tool-overrides";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveServer(name: string) {
  if (name === "front") {
    return (await frontMcpServer().catch(() => null)) ?? undefined;
  }
  const manual = (await getMcpServers()).find((server) => server.name === name);
  if (manual) return manual;
  if (name === "gmail") {
    return (await gmailMcpServer().catch(() => null)) ?? undefined;
  }
  return undefined;
}

export async function GET(req: Request) {
  if (!(await getAuthed())) return unauthorized();
  const server = new URL(req.url).searchParams.get("server") ?? "";
  const config = server ? await resolveServer(server) : undefined;
  if (!config) {
    return Response.json({ ok: false, error: "Unknown server." }, { status: 404 });
  }
  try {
    const [tools, overrides] = await Promise.all([
      listMcpTools(config),
      getToolOverrides(),
    ]);
    const forServer = overrides[server] ?? {};
    return Response.json({
      ok: true,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description.slice(0, 140),
        readOnly: tool.readOnly,
        mode: effectiveMode(tool.readOnly, forServer[tool.name]),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Couldn't list tools.";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { server, tool, mode } = (await req.json().catch(() => ({}))) as {
    server?: string;
    tool?: string;
    mode?: ToolMode;
  };
  if (!server || !tool || !mode || !["auto", "ask", "off"].includes(mode)) {
    return Response.json(
      { ok: false, error: "server, tool, mode required" },
      { status: 400 },
    );
  }
  if (mode === "auto") {
    const config = await resolveServer(server);
    const definition = config
      ? (await listMcpTools(config).catch(() => [])).find(
          (candidate) => candidate.name === tool,
        )
      : undefined;
    if (!definition?.readOnly) {
      return Response.json(
        { ok: false, error: "Write tools always ask — that's the gate." },
        { status: 400 },
      );
    }
  }
  await saveToolOverride(authed.userId, server, tool, mode);
  return Response.json({ ok: true });
}

