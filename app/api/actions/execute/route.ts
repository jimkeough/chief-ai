// Executor for approved write actions — the ONLY code path that performs a
// write. It runs solely in response to an explicit user click on an approval
// card (the human-in-the-loop gate), never from the chat tool loop. Defenses,
// in order:
//   1. Auth — must be the signed-in user (RLS scopes every row on top).
//   2. Default-deny — the action must be in the write-action registry, or the
//      tool must verifiably exist on a configured broker server.
//   3. Kill switches — both the master switch and the write-actions switch
//      must be on.
//   4. Audit — every executed action lands in the journal.
//
// Dispatch is by action.via ("tasks", "kb", "contacts", "projects") for native
// actions; connector (brokered MCP) writes aren't registered actions — they
// take the server-keyed broker path and run via callMcpTool.
//
// Native writes also return an UNDO DESCRIPTOR (lib/undo.ts) describing the
// exact inverse, which powers the receipt card's persistent Undo.

import { getAuthed, unauthorized } from "@/lib/auth";
import { getAppSettings } from "@/lib/settings";
import { getWriteAction, describeMcpArgs } from "@/lib/actions";
import { getMcpServers } from "@/lib/mcp";
import { listMcpTools, callMcpTool } from "@/lib/mcp-broker";
import { createJournalEntry } from "@/lib/journal";
import {
  createKbDocument,
  updateKbDocument,
  getKbDocument,
} from "@/lib/kb/store";
import { reconcileKbEntry, ReconcileError } from "@/lib/kb/reconcile";
import { createContact } from "@/lib/contacts";
import { createNote } from "@/lib/notes";
import { frontMcpServer } from "@/lib/front-mcp";
import { gmailMcpServer } from "@/lib/gmail";
import { getMailProvider } from "@/lib/mail";
import { recordCommunication } from "@/lib/communications";
import type { UndoDescriptor } from "@/lib/undo";
import {
  createTask,
  updateTask,
  getTask,
  type Task,
  type TaskPatch,
  type TaskStatus,
} from "@/lib/tasks";
import {
  createProject,
  updateProject,
  getProject,
  getProjectByName,
  getProjectState,
  upsertProjectState,
  type Project,
  type ProjectStatus,
  type ProjectPatch,
  type ProjectStatePatch,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const authed = await getAuthed();
  if (!authed) return unauthorized();

  const { key, args, server, mergeTargetId } = (await req
    .json()
    .catch(() => ({}))) as {
    key?: string;
    args?: Record<string, unknown>;
    server?: string;
    // Set when the user approved a "Save to Memory" proposal by choosing to
    // MERGE into an existing entry rather than create a new one.
    mergeTargetId?: string;
  };

  // Kill switches: master switch + the write-actions switch must both be on.
  // Checked up front so it covers both the static-action and broker paths.
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

  const safeArgs = (args ?? {}) as Record<string, unknown>;

  // Brokered MCP (connector) write: the proposal carries the target server
  // name. The tool isn't in the static registry, so validate against the live
  // config — DEFAULT-DENY: the server must be configured, and the tool must
  // actually exist on it — before calling it. This path runs ONLY on an
  // explicit user approval of a proposal, so the human-in-the-loop gate is
  // already satisfied. No undo descriptor: the write ran on an external system
  // we can't safely reverse.
  if (server) {
    // The built-in Gmail connection resolves like any configured server, so an
    // approved Gmail MCP write (e.g. create_draft proposed by Chief) executes
    // through the same default-deny path.
    // The built-in official Front connection wins a same-named manual server,
    // matching the broker that created the proposal.
    let cfg =
      server === "front"
        ? ((await frontMcpServer().catch(() => null)) ?? undefined)
        : (await getMcpServers()).find((s) => s.name === server);
    if (!cfg && server === "gmail") {
      cfg = (await gmailMcpServer().catch(() => null)) ?? undefined;
    }
    if (!cfg || !key) {
      return Response.json(
        { ok: false, error: "Unknown or not-permitted server." },
        { status: 400 },
      );
    }
    try {
      const tools = await listMcpTools(cfg);
      const tool = tools.find((candidate) => candidate.name === key);
      if (!tool) {
        return Response.json(
          { ok: false, error: "Unknown or not-permitted tool." },
          { status: 400 },
        );
      }
      // Respect the user's per-tool dial: a tool switched off is refused even
      // on an approval click.
      const { effectiveMode, getToolOverrides } = await import("@/lib/tool-overrides");
      const overrides = await getToolOverrides().catch(() => ({} as import("@/lib/tool-overrides").ToolOverrides));
      const mode = effectiveMode(tool.readOnly, overrides[server]?.[key]);
      if (mode === "off") {
        return Response.json(
          { ok: false, error: "That tool is switched off in Config." },
          { status: 403 },
        );
      }
      if (tool.readOnly && mode !== "ask") {
        return Response.json(
          { ok: false, error: "Automatic read tools cannot use the write executor." },
          { status: 400 },
        );
      }
      const result = await callMcpTool(cfg, key, safeArgs);
      await createJournalEntry({
        title: `${server}: ${key} (via Chief)`,
        note: describeMcpArgs(safeArgs),
        metadata: { action: key, server },
      }).catch(() => {});
      return Response.json({ ok: true, result });
    } catch (e) {
      const error = e instanceof Error ? e.message : "Action failed.";
      return Response.json({ ok: false, error }, { status: 502 });
    }
  }

  // Default-deny: only registered actions are ever executable.
  const action = key ? getWriteAction(key) : undefined;
  if (!action) {
    return Response.json(
      { ok: false, error: "Unknown or not-permitted action." },
      { status: 400 },
    );
  }

  // Optional-string helper shared by the dispatch blocks.
  const opt = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  const journal = (title: string, note: string) =>
    createJournalEntry({
      title,
      note,
      metadata: { action: action.key },
    }).catch(() => {});

  try {
    if (action.via === "tasks") {
      if (action.key === "create_task") {
        const title = String(safeArgs.title ?? "").trim();
        if (!title) {
          return Response.json(
            { ok: false, error: "Task needs a title." },
            { status: 400 },
          );
        }
        let projectId = opt(safeArgs.project_id) ?? null;
        const projectName = opt(safeArgs.project_name);
        if (!projectId && projectName) {
          const project = await getProjectByName(projectName);
          if (!project) {
            return Response.json(
              {
                ok: false,
                error: `Approve the "${projectName}" project first, then retry this task.`,
              },
              { status: 409 },
            );
          }
          projectId = project.id;
        }
        const task = await createTask({
          title,
          notes: opt(safeArgs.notes) ?? null,
          status: opt(safeArgs.status) as TaskStatus | undefined,
          dueAt: opt(safeArgs.due_at) ?? null,
          waitingOn: opt(safeArgs.waiting_on) ?? null,
          projectId,
          source: "chief",
        });
        await journal("Added task", task.title);
        const undo: UndoDescriptor = {
          kind: "delete_task",
          id: task.id,
          label: `Task removed: ${task.title}`,
        };
        return Response.json({
          ok: true,
          result: `Task added — ${task.title}`,
          undo,
        });
      }

      if (action.key === "update_task") {
        const id = String(safeArgs.id ?? "").trim();
        if (!id) {
          return Response.json(
            { ok: false, error: "No task id to update." },
            { status: 400 },
          );
        }
        const before = await getTask(id);
        if (!before) {
          return Response.json(
            { ok: false, error: "Task not found." },
            { status: 404 },
          );
        }
        const patch: TaskPatch = {};
        // Inverse patch: the previous value of every field we change, so Undo
        // restores exactly what the approval overwrote.
        const prev: Record<string, unknown> = {};
        const set = <K extends keyof TaskPatch>(
          k: K,
          v: TaskPatch[K],
          prevValue: unknown,
        ) => {
          patch[k] = v;
          prev[k] = prevValue;
        };
        if (opt(safeArgs.title)) set("title", opt(safeArgs.title), before.title);
        if (safeArgs.notes !== undefined)
          set("notes", opt(safeArgs.notes) ?? null, before.notes);
        if (opt(safeArgs.status))
          set("status", opt(safeArgs.status) as TaskStatus, before.status);
        // waiting_on: an explicit empty string clears it.
        if (safeArgs.waiting_on !== undefined)
          set("waitingOn", opt(safeArgs.waiting_on) ?? null, before.waiting_on);
        if (opt(safeArgs.due_at))
          set("dueAt", opt(safeArgs.due_at), before.due_at);
        if (opt(safeArgs.project_id))
          set("projectId", opt(safeArgs.project_id), before.project_id);

        if (Object.keys(patch).length === 0) {
          return Response.json(
            { ok: false, error: "No changes specified." },
            { status: 400 },
          );
        }
        const updated = (await updateTask(id, patch)) as Task;
        await journal("Updated task", action.preview(safeArgs));
        const undo: UndoDescriptor = {
          kind: "restore_task",
          id,
          fields: prev,
          label: `Task restored: ${updated.title}`,
        };
        return Response.json({
          ok: true,
          result: `Task updated — ${updated.title}`,
          undo,
        });
      }

      return Response.json(
        { ok: false, error: "Unknown task action." },
        { status: 400 },
      );
    }

    if (action.via === "kb") {
      // Save a fact or standing instruction to Memory (chunked + embedded by
      // createKbDocument).
      const title = String(safeArgs.title ?? "").trim();
      const text = String(safeArgs.body ?? "").trim();
      if (!title || !text) {
        return Response.json(
          { ok: false, error: "Both title and body are required." },
          { status: 400 },
        );
      }
      const kind = action.key === "save_instruction" ? "instruction" : "fact";
      const tags =
        kind === "fact" && Array.isArray(safeArgs.tags)
          ? (safeArgs.tags as unknown[]).map(String).filter(Boolean)
          : undefined;

      // Merge path: the user approved this fact by choosing to fold it into an
      // existing entry. Reconcile the two (newer facts win) and update the
      // target in place rather than creating a duplicate. Only facts can merge;
      // if the reconcile fails, surface the error rather than silently creating
      // a new entry, so Memory doesn't drift behind the user's back.
      if (kind === "fact" && mergeTargetId) {
        try {
          const target = await getKbDocument(mergeTargetId);
          if (!target) {
            return Response.json(
              { ok: false, error: "Merge target not found." },
              { status: 404 },
            );
          }
          const merged = await reconcileKbEntry(mergeTargetId, {
            title,
            body: text,
            tags,
          });
          const updated = await updateKbDocument(mergeTargetId, {
            title: merged.title,
            body: merged.body,
            tags: merged.tags,
          });
          if (!updated) {
            return Response.json(
              { ok: false, error: "Merge target not found." },
              { status: 404 },
            );
          }
          await journal(
            "Merged into Memory entry",
            merged.changeSummary || updated.title,
          );
          const undo: UndoDescriptor = {
            kind: "restore_kb",
            id: mergeTargetId,
            title: target.title,
            body: target.body,
            tags: target.tags,
            label: `Memory entry restored: ${target.title}`,
          };
          return Response.json({
            ok: true,
            result: merged.changeSummary
              ? `Merged — ${merged.changeSummary}`
              : `Merged into "${updated.title}".`,
            undo,
          });
        } catch (e) {
          const status = e instanceof ReconcileError ? e.status : 500;
          const message = e instanceof Error ? e.message : "Merge failed.";
          return Response.json({ ok: false, error: message }, { status });
        }
      }

      const doc = await createKbDocument({
        title,
        body: text,
        tags,
        kind,
        source: "chief",
      });
      await journal(action.label, title);
      const undo: UndoDescriptor = {
        kind: "delete_kb",
        id: doc.id,
        label:
          kind === "instruction"
            ? `Instruction removed: ${title}`
            : `Memory entry removed: ${title}`,
      };
      return Response.json({
        ok: true,
        result:
          kind === "instruction"
            ? `Instruction added — ${title}`
            : `Saved to Memory — ${title}`,
        undo,
      });
    }

    if (action.via === "contacts") {
      const name = String(safeArgs.name ?? "").trim();
      const notes = String(safeArgs.notes ?? "").trim();
      if (!name || !notes) {
        return Response.json(
          { ok: false, error: "Both name and notes are required." },
          { status: 400 },
        );
      }
      const email = opt(safeArgs.email);
      const contact = await createContact({
        name,
        emails: email ? [email] : [],
        company: opt(safeArgs.company) ?? null,
        notes,
      });
      await journal("Saved contact", contact.name);
      const undo: UndoDescriptor = {
        kind: "delete_contact",
        id: contact.id,
        label: `Contact removed: ${contact.name}`,
      };
      return Response.json({
        ok: true,
        result: `Contact saved — ${contact.name}`,
        undo,
      });
    }

    if (action.via === "notes") {
      const title = String(safeArgs.title ?? "").trim();
      const body = String(safeArgs.body ?? "").trim();
      if (!title || !body) {
        return Response.json(
          { ok: false, error: "A note needs a title and body." },
          { status: 400 },
        );
      }
      const note = await createNote({
        title,
        body,
        pinned: Boolean(safeArgs.pinned),
      });
      await journal("Saved note", note.title);
      const undo: UndoDescriptor = {
        kind: "delete_note",
        id: note.id,
        label: `Note removed: ${note.title}`,
      };
      return Response.json({
        ok: true,
        result: `Note saved — ${note.title}`,
        undo,
      });
    }

    if (action.via === "projects") {
      // Create/update a project (workstream) or its single current-state
      // record. Every write is journaled. update_project_state stamps
      // last_verified_at on the server so the model never supplies it.

      if (action.key === "create_project") {
        const name = String(safeArgs.name ?? "").trim();
        if (!name) {
          return Response.json(
            { ok: false, error: "Project needs a name." },
            { status: 400 },
          );
        }
        const project = await createProject({
          name,
          summary: opt(safeArgs.summary) ?? null,
          status: opt(safeArgs.status) as ProjectStatus | undefined,
          owner: opt(safeArgs.owner) ?? null,
        });
        await journal("Added project", project.name);
        const undo: UndoDescriptor = {
          kind: "delete_project",
          id: project.id,
          label: `Project removed: ${project.name}`,
        };
        return Response.json({
          ok: true,
          result: `Project added — ${project.name}`,
          undo,
        });
      }

      if (action.key === "update_project") {
        const id = String(safeArgs.id ?? "").trim();
        if (!id) {
          return Response.json(
            { ok: false, error: "No project id to update." },
            { status: 400 },
          );
        }
        const before = await getProject(id);
        if (!before) {
          return Response.json(
            { ok: false, error: "Project not found." },
            { status: 404 },
          );
        }
        const patch: ProjectPatch = {};
        const prev: Record<string, unknown> = {};
        if (opt(safeArgs.name)) {
          patch.name = opt(safeArgs.name);
          prev.name = before.name;
        }
        if (safeArgs.summary !== undefined) {
          patch.summary = opt(safeArgs.summary) ?? null;
          prev.summary = before.summary;
        }
        if (opt(safeArgs.status)) {
          patch.status = opt(safeArgs.status) as ProjectStatus;
          prev.status = before.status;
        }
        if (safeArgs.owner !== undefined) {
          patch.owner = opt(safeArgs.owner) ?? null;
          prev.owner = before.owner;
        }

        if (Object.keys(patch).length === 0) {
          return Response.json(
            { ok: false, error: "No changes specified." },
            { status: 400 },
          );
        }
        const updated = (await updateProject(id, patch)) as Project;
        await journal("Updated project", action.preview(safeArgs));
        const undo: UndoDescriptor = {
          kind: "restore_project",
          id,
          fields: prev,
          label: `Project restored: ${updated.name}`,
        };
        return Response.json({
          ok: true,
          result: `Project updated — ${updated.name}`,
          undo,
        });
      }

      if (action.key === "update_project_state") {
        let projectId = String(safeArgs.project_id ?? "").trim();
        const projectName = opt(safeArgs.project_name);
        if (!projectId && projectName) {
          projectId = (await getProjectByName(projectName))?.id ?? "";
        }
        if (!projectId) {
          return Response.json(
            {
              ok: false,
              error: projectName
                ? `Approve the "${projectName}" project first, then retry its current state.`
                : "No project to update.",
            },
            { status: projectName ? 409 : 400 },
          );
        }
        // Default-deny: the project must exist (RLS already scopes it to this
        // user) before we touch its state row.
        const project = await getProject(projectId);
        if (!project) {
          return Response.json(
            { ok: false, error: "Project not found." },
            { status: 404 },
          );
        }
        const beforeState = await getProjectState(projectId);
        const patch: ProjectStatePatch = {};
        const prev: Record<string, unknown> = {};
        const stateFields = ["current_state", "waiting_on"] as const;
        for (const f of stateFields) {
          if (safeArgs[f] !== undefined) {
            patch[f] = opt(safeArgs[f]) ?? null;
            prev[f] = beforeState ? beforeState[f] : null;
          }
        }

        if (Object.keys(patch).length === 0) {
          return Response.json(
            { ok: false, error: "No changes specified." },
            { status: 400 },
          );
        }
        await upsertProjectState(projectId, patch, new Date().toISOString());
        await journal("Updated project state", project.name);
        // Undo restores the previous field values AND the previous
        // last_verified_at; if there was no state row before, undo deletes it.
        const undo: UndoDescriptor = beforeState
          ? {
              kind: "restore_project_state",
              project_id: projectId,
              fields: { ...prev, last_verified_at: beforeState.last_verified_at },
              label: `Current state restored: ${project.name}`,
            }
          : {
              kind: "delete_project_state",
              project_id: projectId,
              label: `Current state cleared: ${project.name}`,
            };
        return Response.json({
          ok: true,
          result: `Current state updated — ${project.name}`,
          undo,
        });
      }

      return Response.json(
        { ok: false, error: "Unknown project action." },
        { status: 400 },
      );
    }

    if (action.via === "gmail") {
      const threadId = String(safeArgs.thread_id ?? "").trim();
      if (!threadId) {
        return Response.json(
          { ok: false, error: "No email thread to act on." },
          { status: 400 },
        );
      }

      if (action.key === "archive_email") {
        const provider = await getMailProvider();
        if (!provider) {
          return Response.json(
            { ok: false, error: "No mail account is connected." },
            { status: 503 },
          );
        }
        const subject = opt(safeArgs.subject);
        const undo = await provider.archive(threadId, subject);
        await journal("Archived email", subject ?? threadId);
        return Response.json({
          ok: true,
          result: `Archived${subject ? ` — ${subject}` : "."}`,
          ...(undo ? { undo } : {}),
        });
      }

      if (action.key === "reply_email") {
        // The ONE send in the app. Runs only here, only on an approved
        // red-tier proposal (slide-to-send). No undo — it's irreversible.
        const to = Array.isArray(safeArgs.to)
          ? (safeArgs.to as unknown[]).map((t) => String(t).trim()).filter(Boolean)
          : [];
        const cc = Array.isArray(safeArgs.cc)
          ? (safeArgs.cc as unknown[]).map((t) => String(t).trim()).filter(Boolean)
          : [];
        const subject = String(safeArgs.subject ?? "").trim();
        const body = String(safeArgs.body ?? "").trim();
        if (to.length === 0 || !subject || !body) {
          return Response.json(
            { ok: false, error: "The reply needs recipients, a subject, and a body." },
            { status: 400 },
          );
        }
        const provider = await getMailProvider();
        if (!provider) {
          return Response.json(
            { ok: false, error: "No mail account is connected." },
            { status: 503 },
          );
        }
        await provider.send({ threadId, to, cc, subject, body });
        // The outbound lands in the append-only communications log — this is
        // what the waiting-on cross-reference reads.
        await recordCommunication({
          channel: "email",
          direction: "out",
          subject,
          bodyText: body,
          externalThreadId: threadId,
          metadata: { to, cc },
        }).catch(() => {});
        await journal("Sent reply", `${subject} → ${to.join(", ")}`);
        return Response.json({ ok: true, result: `Sent — ${subject}` });
      }

      return Response.json(
        { ok: false, error: "Unknown Gmail action." },
        { status: 400 },
      );
    }

    // Every registered action.via is handled above. Connector writes are not
    // registered actions — they take the server-keyed broker path near the top
    // of this handler — so reaching here means an action with an unhandled
    // `via`, which is a bug rather than user input.
    return Response.json(
      { ok: false, error: "Unsupported action." },
      { status: 400 },
    );
  } catch (e) {
    const error = e instanceof Error ? e.message : "Action failed.";
    return Response.json({ ok: false, error }, { status: 502 });
  }
}
