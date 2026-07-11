import { NextResponse } from "next/server";
import { getAuthed, unauthorized } from "@/lib/auth";
import { getAppSettings, saveAppSettings, SETTING_DEFS } from "@/lib/settings";

export async function GET() {
  if (!(await getAuthed())) return unauthorized();
  const settings = await getAppSettings();
  // Legacy manual MCP JSON may contain bearer tokens. It is migrated through
  // the dedicated write-only Connections API and must never be echoed back to
  // the browser with the ordinary settings bundle.
  return NextResponse.json({
    settings: { ...settings, "mcp.servers": "" },
    defs: SETTING_DEFS,
  });
}

export async function PUT(request: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const updates = { ...(body.settings ?? {}) } as Record<string, string>;
  // New manual connections use /api/mcp/connections. Ignore this key here so a
  // generic settings save can neither inject nor erase plaintext credentials.
  delete updates["mcp.servers"];
  await saveAppSettings(updates, authed.userId);
  const settings = await getAppSettings();
  return NextResponse.json({ settings: { ...settings, "mcp.servers": "" } });
}
