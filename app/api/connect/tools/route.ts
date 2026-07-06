// GET /api/connect/tools?server= — one broker server's tools, classified live
// (read vs. write by MCP annotations) with the user's per-tool modes applied.
// POST { server, tool, mode } — set a tool's mode. Structural rule enforced
// here AND at attach/execute time: a write tool can be "ask" or "off", never
// "auto".

import { getAuthed, unauthorized } from "@/lib/auth";
import { getMcpServers } from "@/lib/mcp";
import { listMcpTools } from "@/lib/mcp-broker";
import { getConnectServers } from "@/lib/chief-connect";
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
  const admin = (await getMcpServers()).find((s) => s.name === name);
  if (admin) return admin;
  if (name === "gmail") return (await gmailMcpServer().catch(() => null)) ?? undefined;
  if (name.startsWith("pipedream-")) {
    return (await getConnectServers().catch(() => [])).find((s) => s.name === name);
  }
  return undefined;
}

export async function GET(req: Request) {
  if (!(await getAuthed())) return unauthorized();
  const server = new URL(req.url).searchParams.get("server") ?? "";
  const cfg = server ? await resolveServer(server) : undefined;
  if (!cfg) {
    return Response.json({ ok: false, error: "Unknown server." }, { status: 404 });
  }
  try {
    const [tools, overrides] = await Promise.all([
      listMcpTools(cfg),
      getToolOverrides(),
    ]);
    const forServer = overrides[server] ?? {};
    return Response.json({
      ok: true,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description.slice(0, 140),
        readOnly: t.readOnly,
        mode: effectiveMode(t.readOnly, forServer[t.name]),
      })),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Couldn't list tools.";
    return Response.json({ ok: false, error }, { status: 502 });
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
    return Response.json({ ok: false, error: "server, tool, mode required" }, { status: 400 });
  }
  // A write can never be promoted to auto — verify against live annotations.
  if (mode === "auto") {
    const cfg = await resolveServer(server);
    const def = cfg
      ? (await listMcpTools(cfg).catch(() => [])).find((t) => t.name === tool)
      : undefined;
    if (!def?.readOnly) {
      return Response.json(
        { ok: false, error: "Write tools always ask — that's the gate." },
        { status: 400 },
      );
    }
  }
  await saveToolOverride(authed.userId, server, tool, mode);
  return Response.json({ ok: true });
}
