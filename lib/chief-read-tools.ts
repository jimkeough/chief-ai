// Read-back / detail-on-demand tools for Chief. Chief's system prompt carries
// only a COMPACT snapshot (active/paused projects + their first few open tasks,
// no notes, no done tasks — see lib/chief.ts#buildCompactSnapshot). These tools
// let it pull the rest live from the DB when a question actually needs it:
//   - list_projects / list_tasks — the fuller lists (with notes)
//   - read_project — one project + its complete state + all its tasks
//   - read_task     — one task with its full notes
//   - search_tasks  — find tasks by keyword across title/notes/waiting-on
// They also serve the original purpose: reading back the live record to verify
// what was just saved (the snapshot is frozen at turn start, so it doesn't
// reflect edits approved earlier in THIS conversation) instead of re-firing an
// unchanged write just to "show" it. They run transparently in the chief loop
// (no approval needed; reads are safe, scoped to the user by RLS). KB
// search/read are reused from lib/kb/tools.ts directly in the route.

import type Anthropic from "@anthropic-ai/sdk";
import { listTasks, getTask, type Task } from "@/lib/tasks";
import {
  listProjectsWithState,
  getProject,
  getProjectState,
  type ProjectWithState,
} from "@/lib/projects";
import { buildTaskDigest, buildProjectDigest } from "@/lib/chief";

export const CHIEF_READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_projects",
    description:
      "Read back the user's CURRENT projects/workstreams and the saved current-state record for each, fresh from the database. Use this to VERIFY what was just saved (after an approved update_project_state / update_project / create_project), to confirm a project exists, or to ground an answer in the live record. Prefer this over re-proposing an unchanged update just to 'show' the state.",
    input_schema: {
      type: "object",
      properties: {
        include_done: {
          type: "boolean",
          description:
            "Include done/archived projects too (default false — active & paused only).",
        },
      },
    },
  },
  {
    name: "list_tasks",
    description:
      "Read back the user's CURRENT task list WITH FULL NOTES (and ids), fresh from the database. The per-turn snapshot omits notes and shows only the first few tasks per project, so use this when you need the complete list or a task's notes. Optionally filter to one project or one status. Also use it to VERIFY a task was created/updated as expected or to check which tasks are filed under a project.",
    input_schema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "Only tasks linked to this project/workstream id.",
        },
        status: {
          type: "string",
          enum: ["open", "waiting", "done"],
          description: "Only tasks with this status.",
        },
        include_done: {
          type: "boolean",
          description: "Include completed tasks (default false).",
        },
      },
    },
  },
  {
    name: "read_project",
    description:
      "Read ONE project in full, fresh from the database: its identity, complete current-state record, what it's waiting on, and ALL of its tasks with their full notes (including done ones). Use this when the compact snapshot isn't enough — e.g. the user asks about a specific project's details, its full state, or all of its tasks.",
    input_schema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The id of the project to read (from the snapshot).",
        },
      },
      required: ["project_id"],
    },
  },
  {
    name: "read_task",
    description:
      "Read ONE task in full, fresh from the database: its status, waiting-on, due date, project, and complete notes. Use this when you need a task's notes or details that the compact snapshot omits.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id of the task to read." },
      },
      required: ["id"],
    },
  },
  {
    name: "search_tasks",
    description:
      "Find tasks by keyword, fresh from the database — matches the query against task titles, notes, and waiting-on text (case-insensitive). Use this to locate tasks the compact snapshot doesn't show without pulling the whole list. Returns matching tasks with their full notes.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The text to search for in titles, notes, and waiting-on.",
        },
        include_done: {
          type: "boolean",
          description: "Include completed tasks in the results (default false).",
        },
      },
      required: ["query"],
    },
  },
];

const NAMES = new Set(CHIEF_READ_TOOLS.map((t) => t.name));

/** True if `name` is one of the chief read-back tools handled here. */
export function isChiefReadTool(name: string): boolean {
  return NAMES.has(name);
}

/** Run a chief read-back tool and return its text result. Assumes the caller has
 *  already checked isChiefReadTool(name). */
export async function runChiefReadTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "list_projects") {
    const includeDone = args.include_done === true;
    const projects = await listProjectsWithState();
    const filtered = includeDone
      ? projects
      : projects.filter((p) => p.status === "active" || p.status === "paused");
    if (filtered.length === 0)
      return includeDone
        ? "The user has no projects/workstreams."
        : "No active or paused projects/workstreams (try include_done to see done/archived ones).";
    // Resolve each project's computed next action for the digest.
    const tasks = await listTasks().catch(() => [] as Task[]);
    return buildProjectDigest(filtered, tasks);
  }

  if (name === "list_tasks") {
    const tasks = await listTasks();
    const projectId =
      typeof args.project_id === "string" ? args.project_id.trim() : "";
    const status = typeof args.status === "string" ? args.status.trim() : "";
    const includeDone = args.include_done === true;
    let filtered = tasks;
    if (projectId) filtered = filtered.filter((t) => t.project_id === projectId);
    if (status) filtered = filtered.filter((t) => t.status === status);
    else if (!includeDone) filtered = filtered.filter((t) => t.status !== "done");
    if (filtered.length === 0) return "No matching tasks.";
    const projects = await listProjectsWithState().catch(() => []);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    return buildTaskDigest(filtered, projectNames);
  }

  if (name === "read_project") {
    const id = typeof args.project_id === "string" ? args.project_id.trim() : "";
    if (!id) return "No project id provided.";
    const project = await getProject(id);
    if (!project) return "Project not found.";
    const state = await getProjectState(id).catch(() => null);
    const projectTasks = await listTasks({ projectId: id }).catch(
      () => [] as Task[],
    );
    const pws: ProjectWithState = { ...project, state };
    const projectNames = new Map([[project.id, project.name]]);
    return [
      buildProjectDigest([pws], projectTasks),
      "",
      "Tasks in this project (full detail, including completed):",
      projectTasks.length
        ? buildTaskDigest(projectTasks, projectNames)
        : "No tasks in this project.",
    ].join("\n");
  }

  if (name === "read_task") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) return "No task id provided.";
    const task = await getTask(id);
    if (!task) return "Task not found.";
    const projects = await listProjectsWithState().catch(() => []);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    return buildTaskDigest([task], projectNames);
  }

  if (name === "search_tasks") {
    const query =
      typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
    if (!query) return "No search query provided.";
    const includeDone = args.include_done === true;
    const tasks = await listTasks();
    const matches = tasks.filter((t) => {
      if (!includeDone && t.status === "done") return false;
      const haystack = [t.title, t.notes ?? "", t.waiting_on ?? ""]
        .join("\n")
        .toLowerCase();
      return haystack.includes(query);
    });
    if (matches.length === 0) return `No tasks match "${args.query}".`;
    const projects = await listProjectsWithState().catch(() => []);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    return buildTaskDigest(matches.slice(0, 40), projectNames);
  }

  return `Unknown tool: ${name}`;
}
