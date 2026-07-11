export type ChiefIntent =
  | { id: "setup.interview" }
  | { id: "setup.mcp" }
  | { id: "inbox.draft_reply"; threadId?: string }
  | { id: "project.refresh_state"; projectId: string }
  | { id: "tasks.triage_open" };

export type ChiefIntentId = ChiefIntent["id"] | "document.review" | "general";

const CHIEF_INTENT_IDS: ChiefIntentId[] = [
  "general",
  "document.review",
  "setup.interview",
  "setup.mcp",
  "inbox.draft_reply",
  "project.refresh_state",
  "tasks.triage_open",
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
    "Review the attached documents as source material. Build one complete, reviewable plan that proposes the projects, tasks, project-state updates, contacts, standing instructions, and reference notes worth saving. Do not execute anything; omit ambiguous writes and explain any important ambiguity.",
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
          "Ask only for information that is genuinely missing, then propose a concise update to the project's current state, next action, waiting-on item, and blockers where appropriate.",
          `The project id is ${intent.projectId}.`,
        ].join(" "),
        title: "Refresh project state",
      };
    case "tasks.triage_open":
      return {
        displayText: "Help me triage my open tasks",
        apiText:
          "Review the open tasks in the page context. Identify what should happen first, flag unclear or unfiled work, and propose only the concrete task or project updates that would improve the plan. Do not execute anything.",
        title: "Triage open tasks",
      };
  }
}
