import { getAuthed, unauthorized } from "@/lib/auth";
import {
  createMcpConnection,
  listMcpConnections,
} from "@/lib/mcp-connections";
import { parseMcpConnectionInput } from "@/lib/mcp-connection-input";
import { invalidateMcpToolCache, listMcpTools } from "@/lib/mcp-broker";
import { publicMcpError } from "@/lib/mcp-public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  if (!(await getAuthed())) return unauthorized();
  try {
    return Response.json({ connections: await listMcpConnections() });
  } catch (error) {
    console.error("Could not load MCP connections:", error);
    const message = publicMcpError(error, "Couldn't load connections.");
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();

  try {
    const input = await parseMcpConnectionInput(await req.json().catch(() => null));
    const tools = await listMcpTools(
      {
        name: input.name,
        url: input.url,
        ...(input.authorizationToken
          ? { authorization_token: input.authorizationToken }
          : {}),
        ...(input.allowedTools?.length ? { allowedTools: input.allowedTools } : {}),
        ...(input.app ? { app: input.app } : {}),
        trustAnnotations: input.trustReadAnnotations,
      },
      { bypassCache: true },
    );

    const connection = await createMcpConnection(authed.userId, input);
    invalidateMcpToolCache();
    return Response.json(
      {
        connection,
        probe: {
          toolCount: tools.length,
          autoCount: tools.filter((tool) => tool.readOnly).length,
          askCount: tools.filter((tool) => !tool.readOnly).length,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Could not create MCP connection:", error);
    const message = publicMcpError(error, "Couldn't connect MCP server.");
    const duplicate = /already exists/i.test(message);
    return Response.json(
      { error: message },
      { status: duplicate ? 409 : 400 },
    );
  }
}

