import { getAuthed, unauthorized } from "@/lib/auth";
import {
  deleteMcpConnection,
  getRuntimeMcpConnection,
  updateMcpConnection,
} from "@/lib/mcp-connections";
import { parseMcpConnectionInput } from "@/lib/mcp-connection-input";
import {
  invalidateMcpToolCache,
  listMcpTools,
} from "@/lib/mcp-broker";
import { publicMcpError } from "@/lib/mcp-public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { id } = await params;

  try {
    const input = await parseMcpConnectionInput(
      await req.json().catch(() => null),
      { allowExistingBearerSecret: true },
    );
    const existing = await getRuntimeMcpConnection(id);
    if (!existing) {
      return Response.json({ error: "MCP connection not found." }, { status: 404 });
    }
    const token =
      input.authType === "bearer"
        ? input.authorizationToken ?? existing.authorization_token
        : undefined;
    if (input.authType === "bearer" && !token) {
      return Response.json(
        { error: "Enter the bearer token for this connection." },
        { status: 400 },
      );
    }
    const tools = await listMcpTools(
      {
        id,
        name: input.name,
        url: input.url,
        ...(token ? { authorization_token: token } : {}),
        ...(input.allowedTools?.length ? { allowedTools: input.allowedTools } : {}),
        ...(input.app ? { app: input.app } : {}),
        trustAnnotations: input.trustReadAnnotations,
      },
      { bypassCache: true },
    );
    const connection = await updateMcpConnection(authed.userId, id, input);
    invalidateMcpToolCache();
    return Response.json({
      connection,
      probe: {
        toolCount: tools.length,
        autoCount: tools.filter((tool) => tool.readOnly).length,
        askCount: tools.filter((tool) => !tool.readOnly).length,
      },
    });
  } catch (error) {
    console.error("Could not update MCP connection:", error);
    const message = publicMcpError(error, "Couldn't update connection.");
    const duplicate = /already exists/i.test(message);
    const missing = /not found/i.test(message);
    return Response.json(
      { error: message },
      { status: duplicate ? 409 : missing ? 404 : 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await params;
  try {
    await deleteMcpConnection(id);
    invalidateMcpToolCache();
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Could not remove MCP connection:", error);
    const message = publicMcpError(error, "Couldn't remove connection.");
    return Response.json({ error: message }, { status: 400 });
  }
}

