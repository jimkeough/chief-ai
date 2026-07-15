import { getAuthed, unauthorized } from "@/lib/auth";
import {
  deleteFrontOAuthConfig,
  getFrontOAuthStatus,
  publicFrontOAuthError,
  saveFrontOAuthConfig,
} from "@/lib/front-auth";
import { invalidateMcpToolCache } from "@/lib/mcp-broker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAuthed())) return unauthorized();
  try {
    return Response.json({ config: await getFrontOAuthStatus() });
  } catch (error) {
    return Response.json(
      { error: publicFrontOAuthError(error, "Couldn't load Front setup.") },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  try {
    const config = await saveFrontOAuthConfig(
      authed.userId,
      await request.json().catch(() => null),
    );
    invalidateMcpToolCache();
    return Response.json({ config });
  } catch (error) {
    return Response.json(
      { error: publicFrontOAuthError(error, "Couldn't save Front setup.") },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  try {
    await deleteFrontOAuthConfig(authed.userId);
    invalidateMcpToolCache();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: publicFrontOAuthError(error, "Couldn't remove Front setup.") },
      { status: 500 },
    );
  }
}
