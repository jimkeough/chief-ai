// Read-back / detail-on-demand tools for Chief. The system prompt carries only
// a COMPACT snapshot (active/paused projects + their first few open tasks, no
// notes, no done tasks — see lib/chief.ts#buildCompactSnapshot). These tools let
// Chief pull the rest live from the DB when a question needs it:
//   - list_projects — compact list of all projects (clipped state + next action)
//   - list_tasks    — compact task list (no notes), filterable
//   - search_tasks  — compact list of tasks matching a keyword
//   - read_project  — ONE project in full: complete state + every task w/ notes
//   - read_task     — ONE task in full, with its notes
//
// Lists/search are compact by default; the read_* tools are the only ones that
// return full notes/state. They run transparently in the chief loop (no
// approval — reads are safe and RLS-scoped to the signed-in user). Each handler
// fetches with a bounded number of queries (no N+1) and formats via the pure
// helpers in lib/chief-read-format.ts. KB search/read live in lib/kb/tools.ts.

import type Anthropic from "@anthropic-ai/sdk";
import {
  listTasks,
  getTask,
  firstOpenTask,
  firstWaitingTask,
  type Task,
} from "@/lib/tasks";
import {
  listProjects,
  listProjectsWithState,
  getProject,
  type ProjectWithState,
} from "@/lib/projects";
import { buildProjectDigest } from "@/lib/chief";
import {
  renderTaskList,
  renderTaskDetail,
  renderProjectListItem,
  resolveProjectRef,
  matchTasks,
} from "@/lib/chief-read-format";
import { getSetting } from "@/lib/settings";
import { checkRoutes, formatRouteChecks } from "@/lib/vercel-checks";

export const CHIEF_READ_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_projects",
    description:
      "List the user's projects/workstreams (compact), fresh from the DB: each with its clipped current state, what it's waiting on, its computed next action, and how many open tasks it has. Active & paused only by default. Use this for an overview or to confirm a project exists; call read_project when you need one project's full state or all its tasks.",
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
      "List the user's tasks (COMPACT — title, status, waiting-on, due, project, id; no notes), fresh from the DB, in manual order. Optionally filter to one project or one status. Use this for the full list or to verify what's stored; call read_task for a task's notes.",
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
    name: "search_tasks",
    description:
      "Find tasks by keyword (COMPACT results, no notes), fresh from the DB — matches the query against task titles, notes, and waiting-on text (case-insensitive). Use this to locate tasks the snapshot doesn't show without pulling the whole list; call read_task for the full notes of a hit.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text to search for in titles, notes, and waiting-on.",
        },
        include_done: {
          type: "boolean",
          description: "Include completed tasks in the results (default false).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_project",
    description:
      "Read ONE project in FULL, fresh from the DB: its identity, complete current-state record, what it's waiting on, and ALL of its tasks with their full notes (including done ones). Use when the compact snapshot/list isn't enough. Accepts the project's id (preferred) or its name.",
    input_schema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "The project's id (preferred — from the snapshot).",
        },
        name: {
          type: "string",
          description:
            "The project's name, if you don't have its id. An ambiguous name returns the candidates to choose from.",
        },
      },
    },
  },
  {
    name: "read_task",
    description:
      "Read ONE task in FULL, fresh from the DB: its status, waiting-on, due date, project, and complete notes. Use this whenever you need a task's notes or details the compact list/snapshot omits. Requires the task's id (use search_tasks or list_tasks to find it).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The id of the task to read." },
      },
      required: ["id"],
    },
  },
  {
    name: "check_routes",
    description:
      'Probe one or more routes on a Vercel PREVIEW deployment and report HTTP status and response timing (TTFB + total). Use it to sanity-check a preview after a branch is pushed: pass the preview URL and the key paths to hit (e.g. ["/", "/tasks"]). Read-only — GET requests only, and only to *.vercel.app hosts. If the preview has Deployment Protection on, the stored Vercel automation bypass secret is used automatically. Note: deployment status, build logs, and runtime errors come from the connected Vercel tools, not this one.',
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The preview deployment URL (https, a *.vercel.app host). Get it from the Vercel deployment.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            'Route paths to check, e.g. ["/", "/tasks"]. Defaults to ["/"]. Up to 10.',
        },
      },
      required: ["url"],
    },
  },
];

const NAMES = new Set(CHIEF_READ_TOOLS.map((t) => t.name));

/** True if `name` is one of the chief read-back tools handled here. */
export function isChiefReadTool(name: string): boolean {
  return NAMES.has(name);
}

// The next-action label for a project's compact list row: the first open task,
// else the first waiting task as an outstanding dependency, else none.
function nextActionLabel(projectTasks: Task[]): string {
  const open = firstOpenTask(projectTasks);
  if (open) return `${open.title} (id: ${open.id})`;
  const waiting = firstWaitingTask(projectTasks);
  if (waiting) {
    const on = waiting.waiting_on ? ` (waiting on ${waiting.waiting_on})` : "";
    return `none actionable — outstanding dependency: ${waiting.title}${on}`;
  }
  return "none — no open tasks";
}

/** Run a chief read tool and return its text result. Assumes the caller has
 *  already checked isChiefReadTool(name). */
export async function runChiefReadTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  if (name === "list_projects") {
    const includeDone = args.include_done === true;
    // Two queries total: projects+state (joined in memory) and the task list.
    const [projects, tasks] = await Promise.all([
      listProjectsWithState(),
      listTasks().catch(() => [] as Task[]),
    ]);
    const filtered = includeDone
      ? projects
      : projects.filter((p) => p.status === "active" || p.status === "paused");
    if (filtered.length === 0)
      return includeDone
        ? "The user has no projects/workstreams."
        : "No active or paused projects/workstreams (pass include_done to see done/archived ones).";
    const tasksByProject = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.project_id) continue;
      const arr = tasksByProject.get(t.project_id);
      if (arr) arr.push(t);
      else tasksByProject.set(t.project_id, [t]);
    }
    return filtered
      .map((p, i) => {
        const pt = tasksByProject.get(p.id) ?? [];
        return renderProjectListItem(p, i, {
          nextAction: nextActionLabel(pt),
          openCount: pt.filter((t) => t.status !== "done").length,
        });
      })
      .join("\n\n");
  }

  if (name === "list_tasks") {
    const projectId =
      typeof args.project_id === "string" ? args.project_id.trim() : "";
    const status = typeof args.status === "string" ? args.status.trim() : "";
    const includeDone = args.include_done === true;
    // Two queries: the (optionally project-scoped) tasks and project names.
    const [tasks, projects] = await Promise.all([
      listTasks(projectId ? { projectId } : {}),
      listProjects().catch(() => []),
    ]);
    let filtered = tasks;
    if (status) filtered = filtered.filter((t) => t.status === status);
    else if (!includeDone) filtered = filtered.filter((t) => t.status !== "done");
    if (filtered.length === 0) return "No matching tasks.";
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    return renderTaskList(filtered, projectNames);
  }

  if (name === "search_tasks") {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return "Provide a search query.";
    const includeDone = args.include_done === true;
    const [tasks, projects] = await Promise.all([
      listTasks(),
      listProjects().catch(() => []),
    ]);
    const matches = matchTasks(tasks, query, includeDone);
    if (matches.length === 0) return `No tasks match "${query.trim()}".`;
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const capped = matches.slice(0, 40);
    const note =
      matches.length > capped.length
        ? ` (showing first ${capped.length} of ${matches.length})`
        : "";
    return renderTaskList(
      capped,
      projectNames,
      `${matches.length} task(s) match "${query.trim()}"${note}:`,
    );
  }

  if (name === "read_project") {
    const id = typeof args.project_id === "string" ? args.project_id.trim() : "";
    const nameArg = typeof args.name === "string" ? args.name.trim() : "";
    const ref = id || nameArg;
    if (!ref) return "Provide the project's id or name.";
    const projects = await listProjectsWithState();
    const resolved = resolveProjectRef(projects, ref);
    if (resolved.kind === "not_found")
      return `No project matches "${ref}". Call list_projects to see the available projects and their ids.`;
    if (resolved.kind === "ambiguous")
      return [
        `"${ref}" matches more than one project — pass the exact id:`,
        ...resolved.matches.map((p) => `- ${p.name} (id: ${p.id})`),
      ].join("\n");
    const project: ProjectWithState = resolved.project;
    const projectTasks = await listTasks({ projectId: project.id }).catch(
      () => [] as Task[],
    );
    const parts = [buildProjectDigest([project], projectTasks)];
    if (projectTasks.length) {
      parts.push(
        `Tasks in this project (${projectTasks.length}, full detail incl. done):`,
        projectTasks.map((t) => renderTaskDetail(t, project.name)).join("\n\n"),
      );
    } else {
      parts.push("No tasks in this project yet.");
    }
    return parts.join("\n\n");
  }

  if (name === "read_task") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) return "Provide the task's id.";
    const task = await getTask(id);
    if (!task)
      return `No task with id "${id}". Use search_tasks or list_tasks to find the right id.`;
    // One extra query only when the task is filed under a project (for its name).
    const project = task.project_id ? await getProject(task.project_id) : null;
    return renderTaskDetail(task, project?.name ?? null);
  }

  if (name === "check_routes") {
    const url = typeof args.url === "string" ? args.url : "";
    if (!url.trim()) return "Provide the preview deployment URL to check.";
    const secret = (await getSetting("vercel.bypass_secret")).trim() || null;
    const res = await checkRoutes({ base: url, paths: args.paths, secret });
    if ("error" in res) return `Can't check routes: ${res.error}`;
    return formatRouteChecks(res.origin, res.results);
  }

  return `Unknown tool: ${name}`;
}
