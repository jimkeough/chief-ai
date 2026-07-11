import { getAuthed, unauthorized } from "@/lib/auth";
import { getRuntimeMcpConnection } from "@/lib/mcp-connections";
import { listMcpTools } from "@/lib/mcp-broker";
import { publicMcpError } from "@/lib/mcp-public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await params;

  try {
    const connection = await getRuntimeMcpConnection(id);
    if (!connection) {
      return Response.json({ error: "MCP connection not found." }, { status: 404 });
    }
    const startedAt = Date.now();
    const tools = await listMcpTools(connection, { bypassCache: true });
    return Response.json({
      ok: true,
      toolCount: tools.length,
      autoCount: tools.filter((tool) => tool.readOnly).length,
      askCount: tools.filter((tool) => !tool.readOnly).length,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("MCP connection test failed:", error);
    const message = publicMcpError(error, "Connection test failed.");
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}

