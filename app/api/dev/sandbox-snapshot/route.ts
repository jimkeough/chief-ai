// POST /api/dev/sandbox-snapshot — build a reusable base snapshot with the
// Claude Code CLI preinstalled, so Runs skip the ~30s install (SANDBOX-PLAN.md,
// step 2). Owner-authed and gated behind `devmode.sandbox_enabled`. Creates a
// fresh VM (no repo), installs the CLI, snapshots it, and stores the snapshot id
// in `devmode.sandbox_snapshot_id`.
//
// This is a one-time / on-demand "Prepare sandbox" action. Runs degrade
// gracefully when no snapshot is set (they just install the CLI), so this is a
// pure optimization. Like the other sandbox routes, it needs the Vercel runtime
// + OIDC token — verify on a preview.

import { getAuthed } from "@/lib/auth";
import { saveAppSettings } from "@/lib/settings";
import {
  buildSandboxSnapshot,
  isSandboxConfigured,
  isSandboxEnabled,
  resolveVercelOidcToken,
} from "@/lib/sandbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Build = create VM + npm install + snapshot; a minute or so. Capped to the
// plan limit (300s on Hobby), which is plenty.
export const maxDuration = 300;

export async function POST() {
  const authed = await getAuthed();
  if (!authed) return new Response("Not signed in.", { status: 401 });

  if (!(await isSandboxEnabled())) {
    return Response.json(
      {
        error:
          "The sandbox dev environment is off. Turn on Config → Developer → \"Sandbox dev environment\" first.",
      },
      { status: 403 },
    );
  }

  if (!(await isSandboxConfigured())) {
    return Response.json(
      {
        error:
          "No Vercel OIDC token is available, so the sandbox can't authenticate. This runs on a Vercel deployment.",
      },
      { status: 400 },
    );
  }

  const vercelOidcToken = await resolveVercelOidcToken();
  const result = await buildSandboxSnapshot({ vercelOidcToken });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 422 });
  }

  try {
    await saveAppSettings(
      { "devmode.sandbox_snapshot_id": result.snapshotId },
      authed.userId,
    );
  } catch (e) {
    return Response.json(
      {
        error: `Built the snapshot but couldn't save it: ${e instanceof Error ? e.message : "unknown error"}`,
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, snapshotId: result.snapshotId });
}
