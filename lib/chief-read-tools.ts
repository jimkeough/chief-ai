// Read-back tools for Chief. Chief is GIVEN the user's projects and task list
// in its system prompt at the start of a turn — but that snapshot is frozen,
// so after it proposes a change and the user approves it, Chief can't "see"
// its own just-saved edit. That led to two bad behaviors in the app this was
// ported from: it would say "I can't verify what's stored", and (lacking a
// read tool) it would re-fire update_project_state just to "show" the state —
// surfacing the same approval card again.
//
// These tools let Chief READ the live record (fresh from the DB) to verify
// what was saved, confirm a task is filed under the right project, or ground an
// answer — instead of re-proposing an unchanged write. They run transparently in
// the chief loop (no approval needed; reads are safe). KB search/read are reused
// from lib/kb/tools.ts directly in the route.

import type Anthropic from "@anthropic-ai/sdk";
import { listTasks, type Task } from "@/lib/tasks";
import { listProjectsWithState } from "@/lib/projects";
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
      "Read back the user's CURRENT task list (with ids), fresh from the database. Optionally filter to one project or one status. Use this to VERIFY a task was created/updated as expected, to check which tasks are filed under a project (\"are they in the right spot?\"), or to ground an answer — instead of re-proposing an unchanged update.",
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

  return `Unknown tool: ${name}`;
}
