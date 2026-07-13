import { randomBytes } from "node:crypto";
import { getAuthed, unauthorized } from "@/lib/auth";
import {
  deleteTriggerRow,
  listTriggers,
  saveTrigger,
  TriggerMigrationRequiredError,
} from "@/lib/events";
import {
  deletePipedreamTrigger,
  deployPipedreamTrigger,
  listPipedreamTriggerComponents,
  publicPipedreamError,
} from "@/lib/pipedream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function migrationRequiredResponse(error: unknown): Response | null {
  if (!(error instanceof TriggerMigrationRequiredError)) return null;
  return Response.json(
    {
      ok: false,
      migrationRequired: true,
      error: error.message,
    },
    { status: 409 },
  );
}

export async function GET(_request: Request, { params }: Params) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { id: connectionId } = await params;
  try {
    // Check the local registry first so an unapplied database migration gets a
    // deterministic recovery response instead of racing a Pipedream API call.
    const triggers = await listTriggers();
    const components = await listPipedreamTriggerComponents(
      authed.userId,
      connectionId,
    );
    return Response.json({
      ok: true,
      components,
      deployed: triggers
        .filter((trigger) => trigger.connection_id === connectionId)
        .map((trigger) => ({
          id: trigger.id,
          componentId: trigger.component_id,
          name: trigger.name,
        })),
    });
  } catch (error) {
    console.error("Could not list Pipedream notifications:", error);
    const migrationResponse = migrationRequiredResponse(error);
    if (migrationResponse) return migrationResponse;
    return Response.json(
      {
        ok: false,
        error: publicPipedreamError(error, "Couldn't list notifications."),
      },
      { status: 502 },
    );
  }
}

export async function POST(request: Request, { params }: Params) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { id: connectionId } = await params;
  const { componentId, configuredProps } = (await request.json().catch(() => ({}))) as {
    componentId?: string;
    configuredProps?: unknown;
  };
  const component = componentId?.trim() ?? "";
  if (!component || component.length > 300) {
    return Response.json(
      { ok: false, error: "Choose a Pipedream notification." },
      { status: 400 },
    );
  }

  try {
    const existing = (await listTriggers()).find(
      (trigger) =>
        trigger.connection_id === connectionId && trigger.component_id === component,
    );
    if (existing) return Response.json({ ok: true, id: existing.id });

    const token = randomBytes(24).toString("hex");
    const webhookUrl = new URL("/api/events/pipedream", request.url);
    webhookUrl.searchParams.set("t", token);
    const deployed = await deployPipedreamTrigger(
      authed.userId,
      connectionId,
      component,
      webhookUrl.href,
      configuredProps,
    );
    try {
      await saveTrigger(authed.userId, {
        id: deployed.id,
        app: deployed.app,
        componentId: component,
        connectionId,
        name: deployed.name,
        token,
        signingKey: deployed.signingKey,
      });
    } catch (error) {
      await deletePipedreamTrigger(authed.userId, deployed.id).catch(() => {});
      throw error;
    }
    return Response.json({ ok: true, id: deployed.id });
  } catch (error) {
    console.error("Could not deploy Pipedream notification:", error);
    const migrationResponse = migrationRequiredResponse(error);
    if (migrationResponse) return migrationResponse;
    return Response.json(
      {
        ok: false,
        error: publicPipedreamError(error, "Couldn't turn on that notification."),
      },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();
  const { id: connectionId } = await params;
  const triggerId = new URL(request.url).searchParams.get("trigger")?.trim() ?? "";
  if (!triggerId) {
    return Response.json({ ok: false, error: "Choose a notification." }, { status: 400 });
  }

  try {
    const trigger = (await listTriggers()).find(
      (candidate) =>
        candidate.id === triggerId && candidate.connection_id === connectionId,
    );
    if (!trigger) {
      return Response.json(
        { ok: false, error: "Pipedream notification not found." },
        { status: 404 },
      );
    }
    await deletePipedreamTrigger(authed.userId, trigger.id);
    await deleteTriggerRow(trigger.id);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Could not delete Pipedream notification:", error);
    const migrationResponse = migrationRequiredResponse(error);
    if (migrationResponse) return migrationResponse;
    return Response.json(
      {
        ok: false,
        error: publicPipedreamError(error, "Couldn't turn off that notification."),
      },
      { status: 502 },
    );
  }
}
