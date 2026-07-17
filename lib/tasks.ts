// The task list — a lightweight personal to-do model. A task holds only what
// needs doing: title, optional project, a three-value status (open/waiting/
// done), optional due date, a free-text "waiting on", notes, and the manual
// `sort` order that is the ONLY priority system. Projects hold the broader
// understanding and current state; tasks stay minimal.
//
// `waiting_since` is stamped internally when a task enters `waiting` (it drives
// Home's aging dot) and is never a user-editable field.
//
// DEPRECATED columns retained in the database for backward compatibility but no
// longer surfaced, written, or ranked on: priority, impact, effort, category,
// delegate_to, waiting_on_contact_id. `source` / `external_id` remain internal
// integration metadata (import de-duplication), never shown to the user.

import { createClient } from "@/lib/supabase/server";

export type TaskStatus = "open" | "waiting" | "done";

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_at: string | null;
  project_id: string | null;
  /** Free text: the person, company, event, or dependency being waited on. */
  waiting_on: string | null;
  /** Stamped when the task enters `waiting`; internal only (drives aging). */
  waiting_since: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
  // --- Deprecated: still in the DB, not surfaced/written by the app ----------
  /** @deprecated Manual sort order is the only priority now. */
  priority: string | null;
  /** @deprecated No longer used. */
  impact: string | null;
  /** @deprecated No longer used. */
  effort: string | null;
  /** @deprecated No longer used. */
  category: string | null;
  /** @deprecated Delegation is now status=waiting + waiting_on + notes. */
  delegate_to: string | null;
  /** @deprecated Waiting-on is now the free-text `waiting_on`. */
  waiting_on_contact_id: string | null;
  /** Internal integration metadata (import source), not user-facing. */
  source: string;
};

// Deprecated columns stay in the select so legacy readers (e.g. Home's
// waiting-on cross-reference for old contact-linked tasks) keep working.
const COLUMNS =
  "id, title, notes, status, due_at, project_id, waiting_on, waiting_since, sort, created_at, updated_at, priority, impact, effort, category, delegate_to, waiting_on_contact_id, source";

// open first, then waiting, then done. Manual `sort` orders within a band.
const STATUS_RANK: Record<TaskStatus, number> = {
  open: 0,
  waiting: 1,
  done: 2,
};

/** Not-done: shown in the active list (open + waiting). */
export function isOpen(task: Task): boolean {
  return task.status !== "done";
}

/** Actionable right now: the user can act without waiting on anyone/anything. */
export function isActionable(task: Task): boolean {
  return task.status === "open";
}

// Pure manual order: `sort` ascending, no status grouping. This is the project
// detail screen's drag order and the source of truth for "what's next".
function compareByManualOrder(a: Task, b: Task): number {
  return a.sort - b.sort || b.created_at.localeCompare(a.created_at);
}

export function sortByManualOrder(tasks: Task[]): Task[] {
  return [...tasks].sort(compareByManualOrder);
}

/** The canonical next action: the first `open` task in manual sort order.
 * `waiting` tasks are never the next action while any open task exists (they're
 * blocked on someone/something else); reordering rewrites `sort`, so this always
 * reflects the current drag order — never a separate ranking. */
export function firstOpenTask(tasks: Task[]): Task | null {
  return sortByManualOrder(tasks.filter(isActionable))[0] ?? null;
}

/** The first `waiting` task in manual order — surfaced as a project's
 * outstanding dependency only when no open task exists (never as active work). */
export function firstWaitingTask(tasks: Task[]): Task | null {
  return sortByManualOrder(tasks.filter((t) => t.status === "waiting"))[0] ?? null;
}

export async function listTasks(
  opts: { projectId?: string } = {},
): Promise<Task[]> {
  const supabase = await createClient();
  let query = supabase.from("tasks").select(COLUMNS);
  if (opts.projectId) query = query.eq("project_id", opts.projectId);
  const { data, error } = await query.limit(300);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Task[];
  // Band by status (open, then waiting, then done), then the user's manual
  // sort, then newest. Manual order is the priority — no priority/impact/effort.
  return rows.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.sort - b.sort ||
      b.created_at.localeCompare(a.created_at),
  );
}

export async function getTask(id: string): Promise<Task | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Task | null) ?? null;
}

export type CreateTaskInput = {
  title: string;
  notes?: string | null;
  status?: TaskStatus;
  dueAt?: string | null;
  projectId?: string | null;
  waitingOn?: string | null;
  source?: string;
  externalId?: string | null;
  sort?: number;
};

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const supabase = await createClient();
  const status = input.status ?? "open";
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: input.title,
      notes: input.notes ?? null,
      status,
      source: input.source ?? "manual",
      external_id: input.externalId ?? null,
      due_at: input.dueAt ?? null,
      project_id: input.projectId ?? null,
      waiting_on: input.waitingOn ?? null,
      // Stamp the aging clock when a task is created already waiting.
      waiting_since: status === "waiting" ? new Date().toISOString() : null,
      sort: input.sort ?? 0,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as Task;
}

export type TaskPatch = {
  status?: TaskStatus;
  title?: string;
  notes?: string | null;
  dueAt?: string | null;
  projectId?: string | null;
  waitingOn?: string | null;
  sort?: number;
};

export async function updateTask(
  id: string,
  patch: TaskPatch,
): Promise<Task | null> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.dueAt !== undefined) update.due_at = patch.dueAt;
  if (patch.projectId !== undefined) update.project_id = patch.projectId;
  // waiting_on is only ever changed when the caller explicitly sends it — a
  // status change alone never rewrites it (leave it as-is unless removed).
  if (patch.waitingOn !== undefined) update.waiting_on = patch.waitingOn;
  if (patch.sort !== undefined) update.sort = patch.sort;

  // `waiting_since` tracks when the task entered waiting — the aging dot on
  // Home compares it against the tunable day threshold. Stamp it on the way
  // in (first time it becomes waiting), clear it on the way out. Internal only.
  if (patch.status !== undefined) {
    update.status = patch.status;
    if (patch.status === "waiting") {
      const existing = await getTask(id);
      if (!existing || existing.status !== "waiting") {
        update.waiting_since = new Date().toISOString();
      }
    } else {
      update.waiting_since = null;
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Task | null) ?? null;
}

export async function deleteTask(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Persist a manual reorder: assign ascending sort to the given task ids. */
export async function reorderTasks(orderedIds: string[]): Promise<void> {
  const supabase = await createClient();
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabase
      .from("tasks")
      .update({ sort: i })
      .eq("id", orderedIds[i]);
    if (error) throw new Error(error.message);
  }
}
