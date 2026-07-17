// Pure formatting + lookup helpers for Chief's local read tools (and the
// compact turn snapshot). Everything here is a plain function over
// already-fetched rows — NO database access, NO Supabase/Next imports (only
// type-only imports, which are erased at runtime) — so it stays fast, has no
// N+1 risk of its own, and is unit-testable without a database.
//
// The split the read tools rely on:
//   - taskLine / renderTaskList  → COMPACT (title, status, waiting-on, due, id;
//     no notes) — the default for list/search results.
//   - renderTaskDetail           → FULL (adds notes) — for targeted reads.
//   - resolveProjectRef          → resolve a project by id OR name, reporting
//     missing vs. ambiguous so the tool can give a useful message.

import type { Task } from "@/lib/tasks";
import type { ProjectWithState } from "@/lib/projects";

export const STATUS_LABEL: Record<string, string> = {
  open: "open",
  waiting: "waiting",
  done: "done",
};

const MAX_NOTE_CHARS = 8000;

/** Collapse whitespace and clip to a single compact line. Returns null if empty. */
export function clipInline(value: string | null, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** One compact task line — no notes. `indent` matches the snapshot's nesting;
 *  `showProject` adds the project name (used by cross-project lists). */
export function taskLine(
  t: Task,
  projectNames?: Map<string, string>,
  opts: { indent?: boolean; showProject?: boolean } = {},
): string {
  const { indent = false, showProject = true } = opts;
  const meta: string[] = [STATUS_LABEL[t.status] ?? t.status];
  if (t.status === "waiting" && t.waiting_on) meta.push(`waiting on ${t.waiting_on}`);
  if (t.due_at) meta.push(`due ${t.due_at.slice(0, 10)}`);
  const projectName =
    showProject && t.project_id ? projectNames?.get(t.project_id) : undefined;
  const projectStr = projectName ? ` (project: ${projectName})` : "";
  return `${indent ? "   - " : "- "}${t.title} [${meta.join(", ")}]${projectStr} (id: ${t.id})`;
}

/** A compact, notes-free list of tasks with a one-line count header. */
export function renderTaskList(
  tasks: Task[],
  projectNames?: Map<string, string>,
  header?: string,
): string {
  if (tasks.length === 0) return "No matching tasks.";
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const head =
    header ??
    `${tasks.length} task(s)${doneCount ? ` (incl. ${doneCount} done)` : ""}, manual order (the order is the priority):`;
  return [head, ...tasks.map((t) => taskLine(t, projectNames))].join("\n");
}

/** A single task in FULL detail, including its complete notes. */
export function renderTaskDetail(t: Task, projectName?: string | null): string {
  const meta: string[] = [STATUS_LABEL[t.status] ?? t.status];
  if (t.status === "waiting" && t.waiting_on) meta.push(`waiting on ${t.waiting_on}`);
  if (t.due_at) meta.push(`due ${t.due_at.slice(0, 10)}`);
  if (projectName) meta.push(`project: ${projectName}`);
  const lines = [`${t.title} [${meta.join(", ")}]`, `id: ${t.id}`];
  if (t.status === "waiting" && t.waiting_since) {
    lines.push(`waiting since: ${t.waiting_since.slice(0, 10)}`);
  }
  const notes = (t.notes ?? "").trim();
  if (notes) {
    const clipped =
      notes.length > MAX_NOTE_CHARS ? `${notes.slice(0, MAX_NOTE_CHARS)}…` : notes;
    lines.push("notes:", clipped);
  }
  return lines.join("\n");
}

/** Case-insensitive keyword match over title, notes, and waiting-on. Done tasks
 *  are excluded unless includeDone. Returns [] for an empty query. */
export function matchTasks(
  tasks: Task[],
  query: string,
  includeDone = false,
): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return tasks.filter((t) => {
    if (!includeDone && t.status === "done") return false;
    const haystack = [t.title, t.notes ?? "", t.waiting_on ?? ""]
      .join("\n")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export type ProjectRef =
  | { kind: "found"; project: ProjectWithState }
  | { kind: "not_found" }
  | { kind: "ambiguous"; matches: ProjectWithState[] };

/** Resolve a project reference that may be an id OR a name. Exact id wins;
 *  then exact (case-insensitive) name; then a unique substring match. Multiple
 *  name/substring hits are reported as ambiguous so the caller can ask which. */
export function resolveProjectRef(
  projects: ProjectWithState[],
  ref: string,
): ProjectRef {
  const r = (ref ?? "").trim();
  if (!r) return { kind: "not_found" };

  const byId = projects.find((p) => p.id === r);
  if (byId) return { kind: "found", project: byId };

  const lower = r.toLowerCase();
  const exact = projects.filter((p) => p.name.trim().toLowerCase() === lower);
  if (exact.length === 1) return { kind: "found", project: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", matches: exact };

  const partial = projects.filter((p) => p.name.toLowerCase().includes(lower));
  if (partial.length === 1) return { kind: "found", project: partial[0] };
  if (partial.length > 1) return { kind: "ambiguous", matches: partial };

  return { kind: "not_found" };
}

/** Compact one-project block for list_projects: identity, clipped state,
 *  waiting-on, the next-action label (computed by the caller), and open count.
 *  No task notes, no full state — read_project gives those. */
export function renderProjectListItem(
  p: ProjectWithState,
  index: number,
  info: { nextAction: string; openCount: number },
): string {
  const head: string[] = [];
  if (p.owner) head.push(`owner/DRI: ${p.owner}`);
  const headTag = head.length ? ` [${head.join(", ")}]` : "";
  const summary = (p.summary ?? "").trim();
  const lines = [
    `${index + 1}. ${p.name}${headTag}${summary ? ` — ${summary}` : ""}`,
    `   id: ${p.id}`,
    `   status: ${p.status}`,
  ];
  lines.push(`   current state: ${clipInline(p.state?.current_state ?? null, 300) ?? "(none recorded)"}`);
  const waiting = clipInline(p.state?.waiting_on ?? null, 200);
  if (waiting) lines.push(`   waiting on: ${waiting}`);
  lines.push(`   next action: ${info.nextAction}`);
  lines.push(`   open tasks: ${info.openCount}`);
  return lines.join("\n");
}
