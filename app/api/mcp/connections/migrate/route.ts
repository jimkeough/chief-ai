import { getAuthed, unauthorized } from "@/lib/auth";
import { migrateLegacyMcpConnections } from "@/lib/mcp-connections";
import { parseMcpServers } from "@/lib/mcp";
import { getSetting } from "@/lib/settings";
import { publicMcpError } from "@/lib/mcp-public-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();

  const raw = await getSetting("mcp.servers");
  const legacy = parseMcpServers(raw);
  if (legacy.length === 0) {
    return Response.json({ ok: true, imported: 0 });
  }

  try {
    const migration = await migrateLegacyMcpConnections(authed.userId, legacy);
    if (migration.errors.length > 0) {
      return Response.json(
        {
          ok: false,
          imported: migration.imported,
          remaining: migration.remaining.length,
          error: "Some legacy connections could not be migrated securely.",
        },
        { status: 400 },
      );
    }
    return Response.json({ ok: true, imported: migration.imported });
  } catch (error) {
    console.error("Legacy MCP migration failed:", error);
    const message = publicMcpError(error, "Legacy migration failed.");
    return Response.json({ ok: false, imported: 0, error: message }, { status: 400 });
  }
}

