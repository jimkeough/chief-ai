// Undo an executed standard-tier action. The executor returned an undo
// descriptor with the receipt (lib/undo.ts); tapping Undo posts it back here
// and this route applies the exact inverse. Same defenses as the executor:
// auth, kill switches, default-deny on the descriptor kind, per-entity field
// whitelists (the descriptor round-tripped through the client, so it's user
// input), RLS on every row, and a journal entry for the audit trail.

import { getAuthed, unauthorized } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { createJournalEntry } from "@/lib/journal";
import { UNDO_KINDS, type UndoDescriptor } from "@/lib/undo";
import { deleteKbDocument, updateKbDocument } from "@/lib/kb/store";
import { deleteContact } from "@/lib/contacts";
import { deleteNote } from "@/lib/notes";
import { gmailMcpServer, unarchiveThread } from "@/lib/gmail";
import { getMailAccount, imapUnarchive } from "@/lib/mail";
import {
  deleteTask,
  updateTask,
  type TaskPatch,
} from "@/lib/tasks";
import {
  deleteProject,
  updateProject,
  deleteProjectState,
  upsertProjectState,
  getProject,
  type ProjectPatch,
  type ProjectStatePatch,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Field whitelists for the restore kinds: only these keys are ever copied out
// of a descriptor's `fields` into a patch. Anything else is dropped.
const TASK_FIELDS = [
  "title",
  "notes",
  "priority",
  "impact",
  "effort",
  "status",
  "category",
  "delegateTo",
  "dueAt",
  "waitingOnContactId",
  "projectId",
] as const;
const PROJECT_FIELDS = ["name", "summary", "status", "owner"] as const;
const STATE_FIELDS = [
  "current_state",
  "next_action",
  "next_task_id",
  "waiting_on",
  "open_loops",
  "blockers",
  "decisions",
  "recent_changes",
  "confidence",
  "last_verified_at",
] as const;

function pick<K extends string>(
  fields: Record<string, unknown>,
  allowed: readonly K[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in fields) out[k] = fields[k];
  }
  return out;
}

export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();

  const { undo } = (await req.json().catch(() => ({}))) as {
    undo?: UndoDescriptor;
  };

  // Same kill switches as the executor: an undo is still a write.
  const settings = await getAppSettings();
  const enabled =
    settings["mcp.chat_enabled"].trim().toLowerCase() === "on" &&
    settings["actions.enabled"].trim().toLowerCase() === "on";
  if (!enabled) {
    return Response.json(
      { ok: false, error: "Write actions are turned off." },
      { status: 403 },
    );
  }

  // Default-deny on the descriptor kind.
  if (!undo || typeof undo !== "object" || !UNDO_KINDS.has(String(undo.kind))) {
    return Response.json(
      { ok: false, error: "Unknown or not-permitted undo." },
      { status: 400 },
    );
  }

  const journal = (note: string) =>
    createJournalEntry({
      title: "Undid an approved action",
      note,
      metadata: { undo: undo.kind },
    }).catch(() => {});

  const label =
    typeof undo.label === "string" && undo.label.trim()
      ? undo.label.trim()
      : "Undone.";

  try {
    if (undo.kind === "delete_task") {
      await deleteTask(String(undo.id ?? ""));
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "restore_task") {
      const fields = pick(
        (undo.fields ?? {}) as Record<string, unknown>,
        TASK_FIELDS,
      ) as TaskPatch;
      if (Object.keys(fields).length === 0) {
        return Response.json(
          { ok: false, error: "Nothing to restore." },
          { status: 400 },
        );
      }
      const restored = await updateTask(String(undo.id ?? ""), fields);
      if (!restored) {
        return Response.json(
          { ok: false, error: "Task not found." },
          { status: 404 },
        );
      }
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "delete_project") {
      await deleteProject(String(undo.id ?? ""));
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "restore_project") {
      const fields = pick(
        (undo.fields ?? {}) as Record<string, unknown>,
        PROJECT_FIELDS,
      ) as ProjectPatch;
      if (Object.keys(fields).length === 0) {
        return Response.json(
          { ok: false, error: "Nothing to restore." },
          { status: 400 },
        );
      }
      const restored = await updateProject(String(undo.id ?? ""), fields);
      if (!restored) {
        return Response.json(
          { ok: false, error: "Project not found." },
          { status: 404 },
        );
      }
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "restore_project_state") {
      const projectId = String(undo.project_id ?? "").trim();
      const project = projectId ? await getProject(projectId) : null;
      if (!project) {
        return Response.json(
          { ok: false, error: "Project not found." },
          { status: 404 },
        );
      }
      const fields = pick(
        (undo.fields ?? {}) as Record<string, unknown>,
        STATE_FIELDS,
      ) as ProjectStatePatch;
      if (Object.keys(fields).length === 0) {
        return Response.json(
          { ok: false, error: "Nothing to restore." },
          { status: 400 },
        );
      }
      // The descriptor carries the previous last_verified_at, and
      // upsertProjectState prefers a patch-supplied value over the stamp — so
      // the restore doesn't fake a fresh verification.
      await upsertProjectState(projectId, fields, new Date().toISOString());
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "delete_project_state") {
      await deleteProjectState(String(undo.project_id ?? ""));
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "delete_kb") {
      await deleteKbDocument(String(undo.id ?? ""));
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "restore_kb") {
      const restored = await updateKbDocument(String(undo.id ?? ""), {
        title: String(undo.title ?? ""),
        body: String(undo.body ?? ""),
        tags: Array.isArray(undo.tags) ? undo.tags.map(String) : [],
      });
      if (!restored) {
        return Response.json(
          { ok: false, error: "Memory entry not found." },
          { status: 404 },
        );
      }
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "delete_contact") {
      await deleteContact(String(undo.id ?? ""));
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "delete_note") {
      await deleteNote(String(undo.id ?? ""));
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "unarchive_thread") {
      const server = await gmailMcpServer();
      if (!server) {
        return Response.json(
          { ok: false, error: "Gmail is not connected." },
          { status: 503 },
        );
      }
      await unarchiveThread(server, String(undo.thread_id ?? ""));
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    if (undo.kind === "unarchive_imap") {
      const account = await getMailAccount();
      if (!account) {
        return Response.json(
          { ok: false, error: "No mail account is connected." },
          { status: 503 },
        );
      }
      await imapUnarchive(
        account,
        String(undo.uid ?? ""),
        String(undo.mailbox ?? "Archive"),
      );
      await journal(label);
      return Response.json({ ok: true, result: label });
    }

    return Response.json(
      { ok: false, error: "Unknown or not-permitted undo." },
      { status: 400 },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : "Undo failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}
