import { getAuthed, unauthorized } from "@/lib/auth";
import {
  createPipedreamConnectLink,
  publicPipedreamError,
} from "@/lib/pipedream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as {
    appSlug?: unknown;
    oauthAppId?: unknown;
  };
  const appSlug = typeof body.appSlug === "string" ? body.appSlug : "";
  const oauthAppId =
    typeof body.oauthAppId === "string" ? body.oauthAppId.trim() : undefined;
  try {
    const origin = new URL(request.url).origin;
    return Response.json({
      url: await createPipedreamConnectLink(authed.userId, appSlug, origin, {
        ...(oauthAppId ? { oauthAppId } : {}),
      }),
    });
  } catch (error) {
    console.error("Could not create Pipedream connection link:", error);
    return Response.json(
      { error: publicPipedreamError(error, "Couldn't start Pipedream authorization.") },
      { status: 400 },
    );
  }
}
