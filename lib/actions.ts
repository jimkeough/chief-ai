// Gated write actions, exposed to Chief as approve/reject cards rather than
// autonomous tools.
//
// CRITICAL — why these are client-side tools, not a hosted MCP connector:
// Anthropic's MCP connector runs tools server-side, before our code ever sees
// the call, so a write routed through it would fire with no interception point
// and no human gate. Instead every write action is a CLIENT-SIDE tool. Claude
// can only emit a tool_use *request*; the chief route catches it, never
// executes it, and streams back a proposal. /api/actions/execute is the only
// code path that performs a write, and only on an explicit user click.
//
// This registry is both the allowlist and the classification. DEFAULT-DENY: a
// tool name not listed here is never executable as an action. Tiers (UI
// language per the design system):
//   yellow — "standard": reversible write, low blast radius (teal card)
//   red    — "irreversible": external / can't be unsent (copper card,
//            slide-to-confirm, never batched)

import type Anthropic from "@anthropic-ai/sdk";
import type { McpServerConfig } from "@/lib/mcp";
import { findEnrichment } from "@/lib/tool-enrichments";

export type ActionTier = "yellow" | "red";

export type WriteAction = {
  /** Tool name Claude calls — also the key the executor dispatches on. */
  key: string;
  /**
   * Where the action runs:
   *  - "tasks": create/update a row in the user's task list.
   *  - "kb": save a fact or standing instruction to Memory (the KB).
   *  - "contacts": save a person to the contacts table.
   *  - "projects": create/update a project or its current-state record.
   *  - "notes": create a free-standing note (reference material, not a task
   *    or a project's current state).
   *  - "gmail": the inbox actions — archive (label change via the official
   *    Gmail MCP server) and the ONE send path (direct Gmail REST call).
   *
   * Connector (brokered MCP) writes are NOT registered here — they flow
   * through the broker and carry their own `server` on the proposal. Curated
   * polish for specific connector tools lives in lib/tool-enrichments.ts.
   */
  via: "tasks" | "kb" | "contacts" | "projects" | "notes" | "gmail";
  /** Informational app/source label for the action. */
  app: string;
  tier: ActionTier;
  /** Short human label for the approval card ("Add task"). */
  label: string;
  /** Tool description shown to the model. */
  description: string;
  /** JSON schema for the arguments. */
  input_schema: Anthropic.Tool["input_schema"];
  /** Human-readable preview of the exact effect, for the approval card. */
  preview: (args: Record<string, unknown>) => string;
};

/** Marker that separates streamed assistant text from a trailing proposals JSON
 *  blob in the chat response (ASCII record separator — never appears in prose).
 *  The chat client splits on this to peel proposals off the text stream. */
export const PROPOSALS_MARKER = "\u001e";

export type ProposedAction = {
  key: string;
  label: string;
  tier: ActionTier;
  app: string;
  args: Record<string, unknown>;
  preview: string;
  /**
   * Set for broker (MCP) proposals: the configured server name the executor
   * must dispatch the tool call to. Absent for the static registry actions
   * above. Its presence is how the executor tells the two apart.
   */
  server?: string;
  /**
   * Existing Memory entries on the same topic, attached to a "Save to Memory"
   * proposal so the approval card can offer "merge into one of these" instead
   * of always creating a new entry. Cheap to compute (one embedding + search,
   * no LLM); the actual merge happens only on an approve-with-target click,
   * via reconcileKbEntry in the executor.
   */
  related?: { id: string; title: string; snippet: string }[];
};

const str = (description: string) => ({ type: "string" as const, description });
const enumStr = (description: string, values: string[]) => ({
  type: "string" as const,
  enum: values,
  description,
});

// Friendly labels for task fields, used in the approval-card preview.
const TASK_PRIORITY_LABEL: Record<string, string> = {
  P0: "P0 (do now)",
  P1: "P1 (high)",
  P2: "P2 (medium)",
  P3: "P3 (low)",
  P4: "P4 (backlog)",
};
const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "not started",
  in_progress: "in progress",
  blocked: "blocked",
  waiting: "waiting on someone",
  done: "done",
};
const TASK_EFFORT_LABEL: Record<string, string> = { s: "small", m: "medium", l: "large" };

const TASK_STATUS_VALUES = [
  "not_started",
  "in_progress",
  "blocked",
  "waiting",
  "done",
];

// Build the changed-fields lines shared by the create/update task previews.
function taskFieldLines(a: Record<string, unknown>): string[] {
  const lines: string[] = [];
  if (a.priority) lines.push(`priority → ${TASK_PRIORITY_LABEL[String(a.priority)] ?? a.priority}`);
  if (a.status) lines.push(`status → ${TASK_STATUS_LABEL[String(a.status)] ?? a.status}`);
  if (a.impact) lines.push(`impact → ${a.impact}`);
  if (a.effort) lines.push(`effort → ${TASK_EFFORT_LABEL[String(a.effort)] ?? a.effort}`);
  if (a.category) lines.push(`category → ${a.category}`);
  if (a.delegate_to) lines.push(`delegate → ${a.delegate_to}`);
  if (a.due_at) lines.push(`due → ${String(a.due_at).slice(0, 10)}`);
  return lines;
}

// Native write actions — those the app executes itself (tasks, Memory,
// contacts, projects). Connector writes (calendar, GitHub, …) are NOT here:
// they flow through the broker, with optional curated polish defined in
// lib/tool-enrichments.ts. Phase 3 ships only standard-tier natives; the first
// red-tier action (send email) arrives with the inbox.
export const WRITE_ACTIONS: WriteAction[] = [
  // --- Task actions ---------------------------------------------------------
  // Chief can propose changes to the user's task list — capture a task, or
  // reprioritize / complete one. Like every write, these are reversible in the
  // UI and never run until the user approves. The chief prompt includes the
  // task list (with ids) so the model can reference existing tasks.
  {
    key: "create_task",
    via: "tasks",
    app: "tasks",
    tier: "yellow",
    label: "Add task",
    description:
      "Propose a NEW task on the user's task list. This does NOT create it immediately — it shows the user an Approve/Dismiss card. Call this only when the user clearly wants to capture a new task, or when you're making a concrete recommendation to add one. Fill in priority/impact/effort when you can infer them; leave them out if you're unsure.",
    input_schema: {
      type: "object",
      properties: {
        title: str("Short task title (the action to take)."),
        notes: str("Optional details: links, sub-steps, who's involved."),
        priority: enumStr("Optional priority.", ["P0", "P1", "P2", "P3", "P4"]),
        impact: enumStr("Optional impact.", ["low", "medium", "high"]),
        effort: enumStr("Optional rough effort size.", ["s", "m", "l"]),
        status: enumStr(
          "Optional status (defaults to not started). Use \"waiting\" when the task is blocked on someone else replying or delivering.",
          TASK_STATUS_VALUES,
        ),
        category: str("Optional category/grouping label."),
        delegate_to: str("Optional person to delegate this to (a name)."),
        due_at: str("Optional due date, ISO 8601 (e.g. 2026-07-12)."),
        waiting_on_contact_id: str(
          "When status is \"waiting\": the id of the saved CONTACT being waited on (from the contacts list). Powers the Waiting-on strip.",
        ),
        project_id: str(
          "Optional: the id of the project/workstream this task belongs to (from the CURRENT STATE: PROJECTS section). Set this when creating a task as a project's next action.",
        ),
      },
      required: ["title"],
    },
    preview: (a) => {
      const lines = taskFieldLines(a);
      return [
        `New task: ${String(a.title ?? "")}`,
        lines.length ? lines.join("\n") : "",
        a.notes ? `\n${String(a.notes)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  },
  {
    key: "update_task",
    via: "tasks",
    app: "tasks",
    tier: "yellow",
    label: "Update task",
    description:
      "Propose a change to an EXISTING task — reprioritize, delegate, change status (including marking it done or waiting), or edit its details. This does NOT apply immediately — it shows the user an Approve/Dismiss card. You MUST pass the task's `id` (shown in the task list as `id: …`). Include only the fields you want to change; leave the rest out. Don't change the title unless the user wants it renamed.",
    input_schema: {
      type: "object",
      properties: {
        id: str("The id of the task to update (from the task list)."),
        title: str("Optional new title (only if renaming)."),
        notes: str("Optional new notes (replaces existing notes)."),
        priority: enumStr("New priority.", ["P0", "P1", "P2", "P3", "P4"]),
        impact: enumStr("New impact.", ["low", "medium", "high"]),
        effort: enumStr("New effort size.", ["s", "m", "l"]),
        status: enumStr(
          "New status. Use \"waiting\" when the task is blocked on someone else replying or delivering.",
          TASK_STATUS_VALUES,
        ),
        category: str("New category/grouping label."),
        delegate_to: str("Person to delegate this to (a name)."),
        due_at: str("New due date, ISO 8601 (e.g. 2026-07-12)."),
        waiting_on_contact_id: str(
          "When setting status to \"waiting\": the id of the saved CONTACT being waited on (from the contacts list). Powers the Waiting-on strip.",
        ),
        project_id: str(
          "Move the task to this project/workstream (its id from the CURRENT STATE: PROJECTS section).",
        ),
      },
      required: ["id"],
    },
    preview: (a) => {
      const lines = taskFieldLines(a);
      if (a.title) lines.unshift(`title → ${String(a.title)}`);
      if (a.notes) lines.push("notes updated");
      return [
        "Update task",
        lines.length ? lines.join("\n") : "(no changes specified)",
      ].join("\n");
    },
  },

  // --- Memory capture -------------------------------------------------------
  // Chief can PROPOSE saving durable long-term memory — a reusable fact worth
  // remembering across conversations. (Internally this is the "kb" store.)
  // Nothing is saved until the user approves.
  {
    key: "save_kb_fact",
    via: "kb",
    app: "kb",
    tier: "yellow",
    label: "Save to Memory",
    description:
      "Propose saving a durable, reusable FACT to the user's long-term Memory — pricing, people, processes, preferences, decisions: something genuinely worth remembering for future conversations. Memory is for durable context only — NOT current project status, next actions, or short-term notes (those belong in Projects/Tasks). This does NOT save immediately; it shows the user an Approve/Dismiss card. Write a short title and a self-contained body (don't assume the reader has seen this conversation). Offer it only when there's real durable knowledge here, never for routine or one-off content, and at most once or twice per conversation.",
    input_schema: {
      type: "object",
      properties: {
        title: str("Short, specific title — the fact at a glance."),
        body: str(
          "The fact, self-contained and clearly worded, with no conversation-specific context the reader won't have.",
        ),
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional 1–4 lowercase single-word tags (e.g. pricing, people, process, preference).",
        },
      },
      required: ["title", "body"],
    },
    preview: (a) => {
      const tags =
        Array.isArray(a.tags) && a.tags.length
          ? `\n\nTags: ${(a.tags as unknown[]).map(String).join(", ")}`
          : "";
      return `${String(a.title ?? "")}\n\n${String(a.body ?? "")}${tags}`;
    },
  },
  {
    key: "save_instruction",
    via: "kb",
    app: "kb",
    tier: "yellow",
    label: "Add standing instruction",
    description:
      "Propose adding a STANDING INSTRUCTION — a durable rule about how the user wants you to behave or handle things (a default, a preference, an always/never). Standing instructions are applied on every future conversation. This does NOT save immediately; it shows an Approve/Dismiss card. Offer it only when the user expresses a clear, reusable preference about how you should work — never for a one-off request. Phrase the body as a crisp imperative addressed to you.",
    input_schema: {
      type: "object",
      properties: {
        title: str("Short label for the rule (≤6 words)."),
        body: str("The rule, 1–2 sentences, imperative, addressed to you."),
      },
      required: ["title", "body"],
    },
    preview: (a) => `${String(a.title ?? "")}\n\n${String(a.body ?? "")}`,
  },

  // --- Contact capture ------------------------------------------------------
  // Save a person to the user's contacts (a real table here — tasks reference
  // waiting_on_contact_id and the communications log attributes messages), so
  // future conversations know who they are. Gated like every write.
  {
    key: "save_contact",
    via: "contacts",
    app: "contacts",
    tier: "yellow",
    label: "Save contact",
    description:
      "Propose saving a PERSON to the user's contacts so future conversations know who they are (their role, company, and how they relate to the user). This does NOT save immediately; it shows an Approve/Dismiss card. Write the person's name, their email if known, and a self-contained note about who they are and what they do. Offer it when you encounter someone genuinely worth remembering, and at most once per conversation. Don't propose saving the user themselves, no-reply/automated addresses, or someone already in their contacts (the contacts list is in your context).",
    input_schema: {
      type: "object",
      properties: {
        name: str("The person's full name."),
        email: str("The person's email address, if known."),
        company: str("The company/organization they belong to, if known."),
        notes: str(
          "Self-contained note on who they are: role, company, and how they relate to the user.",
        ),
      },
      required: ["name", "notes"],
    },
    preview: (a) => {
      const email = a.email ? ` <${String(a.email)}>` : "";
      const company = a.company ? `\n${String(a.company)}` : "";
      return `${String(a.name ?? "")}${email}${company}\n\n${String(a.notes ?? "")}`;
    },
  },

  // --- Notes -----------------------------------------------------------------
  // Free-standing notes — reference material that isn't itself a task or a
  // project's current state (background info, a summary of a document, raw
  // meeting notes). Gated like every write; runs only via the "notes" path in
  // the executor.
  {
    key: "create_note",
    via: "notes",
    app: "notes",
    tier: "yellow",
    label: "Save note",
    description:
      "Propose saving a NOTE — free-standing reference material that isn't itself a task or a project's current state (e.g. a summary of a document you analyzed, raw meeting notes, background info worth keeping around). This does NOT save immediately; it shows an Approve/Dismiss card. Prefer create_project/create_task/update_project_state for anything that's actually a workstream or an action — use create_note for content that's genuinely just reference material.",
    input_schema: {
      type: "object",
      properties: {
        title: str("Short, specific title."),
        body: str("The note's full content."),
        pinned: {
          type: "boolean",
          description: "Optional: pin this note so it stays at the top of the list.",
        },
      },
      required: ["title", "body"],
    },
    preview: (a) => {
      const pinned = a.pinned ? " (pinned)" : "";
      return `${String(a.title ?? "")}${pinned}\n\n${String(a.body ?? "")}`;
    },
  },

  // --- Project / workstream + current-state ---------------------------------
  // Projects/workstreams are the primary organizing layer; their current-state
  // record is what Chief reads to answer "what's my current work state?".
  // Chief can PROPOSE creating a project or updating a project's state — gated
  // like every write, run only on approval via the executor's via:"projects"
  // path. update_project_state is replace-per-field.
  {
    key: "create_project",
    via: "projects",
    app: "projects",
    tier: "yellow",
    label: "Add project / workstream",
    description:
      "Propose a NEW project or ongoing workstream. This does NOT create it immediately — it shows an Approve/Dismiss card. Use this when a real workstream isn't tracked yet — e.g. a cluster of related unfiled tasks clearly belongs to one. A project can be a finite project OR an ongoing area of responsibility.",
    input_schema: {
      type: "object",
      properties: {
        name: str("Short project/workstream name."),
        summary: str("Optional one-liner: what this project or workstream is."),
        status: enumStr("Optional status (defaults to active).", [
          "active",
          "paused",
          "done",
          "archived",
        ]),
        owner: str("Optional owner (a name)."),
      },
      required: ["name"],
    },
    preview: (a) => {
      const lines = [`New project/workstream: ${String(a.name ?? "")}`];
      if (a.status) lines.push(`status → ${String(a.status)}`);
      if (a.owner) lines.push(`owner → ${String(a.owner)}`);
      if (a.summary) lines.push(`\n${String(a.summary)}`);
      return lines.join("\n");
    },
  },
  {
    key: "update_project",
    via: "projects",
    app: "projects",
    tier: "yellow",
    label: "Update project",
    description:
      "Propose a change to an EXISTING project/workstream's identity — rename, change status (e.g. mark it done/paused), set its owner or summary. This does NOT apply immediately — it shows an Approve/Dismiss card. You MUST pass the project's `id` (shown as `id: …` in the CURRENT STATE: PROJECTS section). Include only the fields you want to change. To edit the project's current state (open loops, blockers, etc.), use update_project_state instead.",
    input_schema: {
      type: "object",
      properties: {
        id: str("The id of the project to update (from the projects section)."),
        name: str("Optional new name (only if renaming)."),
        summary: str("Optional new summary."),
        status: enumStr("New status.", ["active", "paused", "done", "archived"]),
        owner: str("New owner (a name)."),
      },
      required: ["id"],
    },
    preview: (a) => {
      const lines = ["Update project"];
      if (a.name) lines.push(`name → ${String(a.name)}`);
      if (a.status) lines.push(`status → ${String(a.status)}`);
      if (a.owner) lines.push(`owner → ${String(a.owner)}`);
      if (a.summary) lines.push(`summary → ${String(a.summary)}`);
      return lines.length > 1 ? lines.join("\n") : "Update project (no changes specified)";
    },
  },
  {
    key: "update_project_state",
    via: "projects",
    app: "projects",
    tier: "yellow",
    label: "Update current state",
    description:
      "Propose an updated CURRENT-STATE record for a project/workstream — its current state, next action, what it's waiting on, open loops, blockers, decisions, and recent changes. This does NOT apply immediately — it shows an Approve/Dismiss card. You MUST pass the project's `id` as `project_id` (shown in the CURRENT STATE: PROJECTS section). REPLACE-PER-FIELD: pass only the fields that should change, and for each field you set, write the FULL new text for it (it replaces that field) — carry forward what's still true rather than writing only the delta. Ground every field in the actual tasks, activity, and Memory evidence; don't invent. (The approval stamps when the state was last verified automatically.)",
    input_schema: {
      type: "object",
      properties: {
        project_id: str("The id of the project whose state to update."),
        current_state: str("Where this stands right now — the headline. Full new text."),
        next_action: str(
          "The single most important next move, as free text. Prefer linking an actual task via next_task_id; use this for the fallback wording or when no task exists yet.",
        ),
        next_task_id: str(
          "Optional: the id of the OPEN task (from the task list) that is this project's primary next action. Link it when a matching task exists; if none does, leave this out and propose create_task instead.",
        ),
        waiting_on: str("What/who we're waiting on externally. Full new text."),
        open_loops: str("What's outstanding / in flight. Full new text."),
        blockers: str("What's stuck on us, and why. Full new text."),
        decisions: str("Decisions made / direction set. Full new text."),
        recent_changes: str("What moved recently. Full new text."),
        confidence: enumStr("How sure you are about this record.", [
          "low",
          "medium",
          "high",
        ]),
      },
      required: ["project_id"],
    },
    preview: (a) => {
      const f = (label: string, v: unknown) =>
        v && String(v).trim() ? `${label}:\n${String(v).trim()}` : "";
      const parts = [
        f("Current state", a.current_state),
        f("Next action", a.next_action),
        a.next_task_id ? "Links next action to an existing task" : "",
        f("Waiting on", a.waiting_on),
        f("Open loops", a.open_loops),
        f("Blockers", a.blockers),
        f("Decisions", a.decisions),
        f("Recent changes", a.recent_changes),
        a.confidence ? `Confidence: ${String(a.confidence)}` : "",
      ].filter(Boolean);
      return parts.length
        ? parts.join("\n\n")
        : "Update current state (no fields specified)";
    },
  },

  // --- Inbox actions (Gmail) -------------------------------------------------
  // The archive is a label change through the official Gmail MCP server —
  // reversible, standard tier. The reply is the app's FIRST irreversible
  // action: an actual send (direct Gmail REST call in the executor), so it's
  // red tier — the copper card with the exact payload and slide-to-send,
  // never batched, never one-tap.
  {
    key: "archive_email",
    via: "gmail",
    app: "gmail",
    tier: "yellow",
    label: "Archive email",
    description:
      "Propose archiving an email thread — it leaves the inbox (the INBOX label is removed; reversible). This does NOT archive immediately; it shows an Approve/Dismiss card. Pass the `thread_id` from the inbox page context. Propose it when the email needs no further action (an FYI, a notification, or once a reply has been sent).",
    input_schema: {
      type: "object",
      properties: {
        thread_id: str("The Gmail thread id (from the inbox page context)."),
        subject: str("The email's subject, for the card label."),
      },
      required: ["thread_id"],
    },
    preview: (a) =>
      `Archive${a.subject ? `: ${String(a.subject)}` : " this email"} — removes it from the inbox (reversible).`,
  },
  {
    key: "reply_email",
    via: "gmail",
    app: "gmail",
    tier: "red",
    label: "Send reply",
    description:
      "Propose SENDING a reply to an email thread through the user's Gmail. This is IRREVERSIBLE once approved — the user confirms with a slide gesture, and the email actually sends. Write the complete reply body, ready to send (appropriate greeting and sign-off, NO placeholders). Pass the `thread_id` and reply to the people already on the thread (`to` = the sender of the message being answered; keep the original subject with a Re: prefix). Use it only when the user clearly wants to send a reply.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: str("The Gmail thread id (from the inbox page context)."),
        to: {
          type: "array",
          items: { type: "string" },
          description:
            "Recipient email addresses — normally just the sender being replied to. Plain addresses only.",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Optional CC addresses (plain addresses only).",
        },
        subject: str('The subject, normally the original prefixed with "Re: ".'),
        body: str("Full reply body, ready to send. No placeholders."),
      },
      required: ["thread_id", "to", "subject", "body"],
    },
    preview: (a) => {
      const to = Array.isArray(a.to) ? (a.to as unknown[]).map(String).join(", ") : "";
      const cc =
        Array.isArray(a.cc) && a.cc.length
          ? `\nCc: ${(a.cc as unknown[]).map(String).join(", ")}`
          : "";
      return `To: ${to}${cc}\nSubject: ${String(a.subject ?? "")}\n\n${String(a.body ?? "")}`;
    },
  },
];

const BY_KEY = new Map(WRITE_ACTIONS.map((a) => [a.key, a]));

/** Look up a registered action by tool name. Returns undefined for anything not
 *  in the registry — the default-deny gate for both the chief loop and executor. */
export function getWriteAction(name: string): WriteAction | undefined {
  return BY_KEY.get(name);
}

/** Client-side tool definitions for the model (name + description + schema). */
export function writeActionTools(): Anthropic.Tool[] {
  return WRITE_ACTIONS.map((a) => ({
    name: a.key,
    description: a.description,
    input_schema: a.input_schema,
  }));
}

/** Short labels for the system prompt's "available actions" line. */
export function writeActionLabels(): string[] {
  return WRITE_ACTIONS.map((a) => a.label);
}

/** Compact, readable preview of a broker tool's arguments for the approval
 *  card. Long values are clipped so a big SQL blob or file body stays legible. */
export function describeMcpArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return "(no arguments)";
  return entries
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      const clipped = val.length > 600 ? `${val.slice(0, 600)}…` : val;
      return `${k}: ${clipped}`;
    })
    .join("\n");
}

/** Build a proposal for a brokered MCP write tool. These aren't in the static
 *  registry — the tool + schema come from the server at runtime — so the
 *  proposal carries the server name for the executor to dispatch on. `key` is
 *  the EXACT tool name the model called (prefixed if the server has a
 *  toolPrefix); the executor matches and de-prefixes it.
 *
 *  A curated tool (lib/tool-enrichments.ts) supplies a nicer label, tier, and a
 *  real preview; otherwise the label is the server's friendly name (with
 *  account label) + the bare tool name, the tier is the safe default "red"
 *  (irreversible), and the preview is the generic arg dump. */
export function toMcpProposal(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): ProposedAction {
  const bareTool =
    server.toolPrefix && toolName.startsWith(server.toolPrefix)
      ? toolName.slice(server.toolPrefix.length)
      : toolName;
  const appBase = server.app ?? server.name;
  const display = server.accountLabel ? `${appBase} (${server.accountLabel})` : appBase;
  const enrichment = findEnrichment(server, toolName);
  return {
    key: toolName,
    label: enrichment?.label ?? `${display}: ${bareTool}`,
    tier: enrichment?.tier ?? "red",
    app: appBase,
    server: server.name,
    args,
    preview: enrichment?.preview ? enrichment.preview(args) : describeMcpArgs(args),
  };
}

/** True when an `update_*` action carries no changeable fields beyond its id —
 *  a no-op the model sometimes fires (e.g. to "show" current state). Callers
 *  should refuse to propose or execute these and read the state back instead.
 *  Conservative: an update is empty only when NO non-id field is present at all,
 *  so deliberately clearing a field (passing it as empty) still counts as a
 *  change. */
export function isEmptyUpdate(
  name: string,
  args: Record<string, unknown>,
): boolean {
  if (
    name !== "update_task" &&
    name !== "update_project" &&
    name !== "update_project_state"
  ) {
    return false;
  }
  const idKeys = name === "update_project_state" ? ["project_id"] : ["id"];
  return !Object.keys(args ?? {}).some(
    (k) => !idKeys.includes(k) && args[k] !== undefined,
  );
}

/** Build the UI proposal from a tool call, or null if the tool isn't a
 *  registered action (default-deny) or is a no-op update with nothing to change. */
export function toProposedAction(
  name: string,
  args: Record<string, unknown>,
): ProposedAction | null {
  const a = getWriteAction(name);
  if (!a) return null;
  if (isEmptyUpdate(name, args)) return null;
  return {
    key: a.key,
    label: a.label,
    tier: a.tier,
    app: a.app,
    args,
    preview: a.preview(args),
  };
}

/** Lead project proposals' card labels with the project name so the user can
 *  tell which workstream each card would change. The proposal args only carry
 *  the project's id (a UUID), so the caller passes a resolver from id → name
 *  (create_project carries its name directly). Non-project proposals pass through
 *  unchanged. */
export function nameProjectProposals(
  proposals: ProposedAction[],
  nameById: (id: string) => string | undefined,
): ProposedAction[] {
  return proposals.map((p) => {
    if (p.key === "create_project") {
      const n = String(p.args.name ?? "").trim();
      return n ? { ...p, label: `New workstream: ${n}` } : p;
    }
    if (p.key === "update_project") {
      const n = nameById(String(p.args.id ?? ""));
      return n ? { ...p, label: `${n} — project details` } : p;
    }
    if (p.key === "update_project_state") {
      const n = nameById(String(p.args.project_id ?? ""));
      return n ? { ...p, label: `${n} — current state` } : p;
    }
    return p;
  });
}
