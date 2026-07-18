export type ChiefIntent =
  | { id: "setup.interview" }
  | { id: "setup.mcp" }
  | { id: "inbox.draft_reply"; threadId?: string }
  | { id: "project.refresh_state"; projectId: string }
  | {
      id: "project.plan_next_steps";
      projectId: string;
      projectName: string;
    }
  | {
      id: "home.draft_follow_up";
      taskId: string;
      contactName: string;
    }
  | { id: "tasks.triage_open" }
  | { id: "app.update" };

export type ChiefIntentId = ChiefIntent["id"] | "document.review" | "general";

const CHIEF_INTENT_IDS: ChiefIntentId[] = [
  "general",
  "document.review",
  "setup.interview",
  "setup.mcp",
  "inbox.draft_reply",
  "project.refresh_state",
  "project.plan_next_steps",
  "home.draft_follow_up",
  "tasks.triage_open",
  "app.update",
];

export function isChiefIntentId(value: unknown): value is ChiefIntentId {
  return (
    typeof value === "string" &&
    CHIEF_INTENT_IDS.includes(value as ChiefIntentId)
  );
}

export type ResolvedChiefIntent = {
  displayText: string;
  apiText: string;
  title: string;
};

export const DOCUMENT_REVIEW_INTENT: ResolvedChiefIntent = {
  displayText: "Review these documents",
  apiText:
    "Review the attached documents as source material. Extract their projects, tasks, current state, contacts, standing instructions, and reference notes in bounded batches; then reconcile them with the workspace and compile one complete approval plan. Do not execute anything.",
  title: "Review documents",
};

export function resolveChiefIntent(intent: ChiefIntent): ResolvedChiefIntent {
  switch (intent.id) {
    case "setup.interview":
      return {
        displayText: "Interview me about my work",
        apiText:
          "Interview me about my work — one question at a time — and as real structure emerges, propose the projects, tasks, contacts, and standing instructions to capture it. Start by asking what I do and what's on my plate right now.",
        title: "Work setup interview",
      };
    case "setup.mcp":
      return {
        displayText: "Help me connect a tool to Chief",
        apiText:
          "Help me connect a direct MCP server to Chief. Start by asking which service or tool I want to connect. Guide me one step at a time to verify whether it offers an official remote MCP server and find its documented URL and authentication method. Never invent an endpoint or claim one exists without verified details. Never ask me to paste a secret into chat; tell me to enter credentials only in Settings → Connections → Add MCP connection. Once we identify the details, explain exactly what to enter there.",
        title: "Connect a tool",
      };
    case "inbox.draft_reply":
      return {
        displayText: "Draft a reply to this email",
        apiText: [
          "Draft a reply to the email in the current page context, in my voice.",
          "Show me the exact draft and propose sending it; do not send it without my explicit approval.",
          intent.threadId ? `The expected thread id is ${intent.threadId}.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        title: "Draft an email reply",
      };
    case "project.refresh_state":
      return {
        displayText: "Refresh this project's current state",
        apiText: [
          "Review the project, current state, and open tasks in the page context.",
          "Ask only for information that is genuinely missing, then propose a concise update to the project's current state and what it's waiting on, folding any blocker, decision, or recent change into the current-state prose. The next action is simply the first open task, so reorder or add tasks rather than writing it into the state.",
          `The project id is ${intent.projectId}.`,
        ].join(" "),
        title: "Refresh project state",
      };
    case "project.plan_next_steps":
      return {
        displayText: `Plan the next steps for ${intent.projectName}`,
        apiText: [
          "Review this project's goal, current state, and open tasks from the page context.",
          "Turn its current position into a practical short plan: identify the next one to three actions, important dependencies or blockers, and any missing decisions.",
          "Preserve useful existing work and avoid duplicate tasks.",
          "Propose only the concrete task or project-state changes that would improve the plan. Do not execute anything.",
          `The project id is ${intent.projectId}.`,
        ].join(" "),
        title: `Plan ${intent.projectName}`,
      };
    case "home.draft_follow_up":
      return {
        displayText: `Draft a follow-up to ${intent.contactName}`,
        apiText: [
          `Draft a concise, considerate follow-up for the Home waiting item whose task id is ${intent.taskId}.`,
          "Use the matching waiting item and contact details in the page context to reference what I am waiting for and how long it has been quiet.",
          "Show me the complete ready-to-send draft first. Do not change the task.",
          "If email read tools are available, find the relevant thread using both the contact email and the waiting-item context. Never assume the contact's latest thread is the right one, and never invent a thread id. Propose reply_email only when the matching thread is unambiguous; otherwise give me a copy-paste draft without a send proposal.",
          "Sending remains irreversible: never send without my explicit approval.",
        ].join(" "),
        title: `Follow up with ${intent.contactName}`,
      };
    case "tasks.triage_open":
      return {
        displayText: "Help me triage my open tasks",
        apiText:
          "Review the open tasks in the page context. Identify what should happen first, flag unclear or unfiled work, and propose only the concrete task or project updates that would improve the plan. Do not execute anything.",
        title: "Triage open tasks",
      };
    case "app.update":
      return {
        displayText: "Update this app",
        apiText: [
          "I want to change this app's own code. Help me make the change through the review-gated dev loop.",
          "If what I want isn't already clear, ask me one focused question first. Then read the relevant files before proposing any edit — don't guess file contents — and propose a branch, the commits, and a pull request for me to review and merge. Do not merge or deploy; my merge is the approval.",
        ].join(" "),
        title: "Update this app",
      };
  }
}
