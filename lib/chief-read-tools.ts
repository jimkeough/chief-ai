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
import {
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  searchFrontConversations,
  searchTaggedOpenConversations,
} from "@/lib/front-search";
import { diagnosePipedreamConnect } from "@/lib/pipedream-diagnose";

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
          enum: ["not_started", "in_progress", "blocked", "waiting", "done"],
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
    name: "diagnose_pipedream_connect",
    description:
      "Diagnose whether Pipedream Connect Proxy works versus Pipedream MCP for Front (and probes another connected app when possible). Use when Front tag search says credentials were rejected but Calendar/MCP tools still work — those are different paths. Returns a summary plus per-target probe results. Read-only.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "search_front_conversations",
    description:
      "Search conversations through Front's official MCP server. Uses scope=all_inboxes and exact tag IDs when provided. Default status is open; pass status=\"all\" to omit the status filter. Prefer tag_id / Config front.inbox_zero_tag_id. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        tag_name: {
          type: "string",
          description: "Optional exact Front tag name filter (company or private teammate tag).",
        },
        tag_id: {
          type: "string",
          description:
            "Optional Front tag id (tag_…). Skips list_tags name lookup. Prefer Config → Front — Chief Inbox Zero tag id for that tag.",
        },
        status: {
          type: "string",
          description:
            'Default "open". Front MCP supports "open", "all", "archived", and "trashed".',
        },
        assignee: {
          type: "string",
          description: "Optional teammate name, email, or tea_ id for filters.teammateId.",
        },
        limit: {
          type: "number",
          description: "Requested page size hint; Front MCP controls its page size.",
        },
        cursor: {
          type: "string",
          description: "nextCursor from the previous page.",
        },
      },
    },
  },
  {
    name: "search_front_tagged_conversations",
    description: `Convenience alias for official Front MCP search_conversations with tag_name defaulting to "${DEFAULT_FRONT_INBOX_ZERO_TAG}". Pass status=\"all\" to omit the status filter.`,
    input_schema: {
      type: "object",
      properties: {
        tag_name: {
          type: "string",
          description: `Exact Front tag name (default "${DEFAULT_FRONT_INBOX_ZERO_TAG}").`,
        },
        tag_id: {
          type: "string",
          description:
            "Front tag id (tag_…). Prefer Config → Front — Chief Inbox Zero tag id.",
        },
        status: {
          type: "string",
          description:
            'Default "open". Use "all" for full tag inventory including no-inbox discussions.',
        },
        limit: {
          type: "number",
          description: "Requested page size hint; Front MCP controls its page size.",
        },
        cursor: {
          type: "string",
          description: "nextCursor from the previous page.",
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
    // Resolve each project's "primary next task" link for the digest.
    const tasks = await listTasks().catch(() => [] as Task[]);
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    return buildProjectDigest(filtered, tasksById);
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

  if (name === "diagnose_pipedream_connect") {
    return JSON.stringify(await diagnosePipedreamConnect());
  }

  if (name === "search_front_conversations") {
    const tagName = typeof args.tag_name === "string" ? args.tag_name : undefined;
    const tagId = typeof args.tag_id === "string" ? args.tag_id : undefined;
    const result = await searchFrontConversations({
      tagName,
      tagId,
      status: typeof args.status === "string" ? args.status : undefined,
      assignee: typeof args.assignee === "string" ? args.assignee : undefined,
      participant:
        typeof args.participant === "string" ? args.participant : undefined,
      teammate: typeof args.teammate === "string" ? args.teammate : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      cursor: typeof args.cursor === "string" ? args.cursor : undefined,
      // Never silently under-count a tagged inventory via inbox-scoped Search.
      allowSearchFallback: !(tagName || tagId),
    });
    return JSON.stringify(result);
  }

  if (name === "search_front_tagged_conversations") {
    const result = await searchTaggedOpenConversations({
      tagName: typeof args.tag_name === "string" ? args.tag_name : undefined,
      tagId: typeof args.tag_id === "string" ? args.tag_id : undefined,
      status: typeof args.status === "string" ? args.status : undefined,
      teammate: typeof args.teammate === "string" ? args.teammate : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      cursor: typeof args.cursor === "string" ? args.cursor : undefined,
    });
    return JSON.stringify(result);
  }

  return `Unknown tool: ${name}`;
}
