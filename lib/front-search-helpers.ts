// Pure Front search helpers — no server/runtime imports (safe for strip-types tests).

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const FRONT_API_BASE = "https://api2.frontapp.com";
export const DEFAULT_FRONT_INBOX_ZERO_TAG = "Chief Inbox Zero";
export const FRONTAPP_PIPEDREAM_SLUG = "frontapp";

export function resultsFrom(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  const envelope = record(response);
  return Array.isArray(envelope._results) ? envelope._results : [];
}

export function pageTokenFromNext(next: unknown): string | null {
  const value = text(next);
  if (!value) return null;
  try {
    return new URL(value).searchParams.get("page_token");
  } catch {
    return value;
  }
}

export function buildTaggedOpenQuery(tagId: string): string {
  const id = text(tagId);
  if (!/^tag_[a-zA-Z0-9]+$/.test(id)) {
    throw new Error("Front returned an invalid tag ID.");
  }
  return `tag:${id} is:open`;
}

export function resolveExactTag(
  matches: unknown[],
  requestedName: string,
): { id: string; name: string } {
  const exact = matches.filter((tag) => text(record(tag).name) === requestedName);
  const candidates = exact.length ? exact : matches;
  if (candidates.length === 0) {
    throw new Error(`Front tag "${requestedName}" was not found.`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `More than one Front tag is named "${requestedName}". Rename the target tag so it is unique.`,
    );
  }
  const tag = record(candidates[0]);
  const id = text(tag.id);
  const name = text(tag.name);
  if (!id || !name) throw new Error(`Front tag "${requestedName}" was incomplete.`);
  return { id, name };
}

function personLabel(value: unknown): string {
  const person = record(value);
  return (
    text(person.name) ||
    `${text(person.first_name)} ${text(person.last_name)}`.trim() ||
    text(person.email) ||
    text(person.handle)
  );
}

export type CompactFrontConversation = {
  id: string;
  subject: string;
  status: string;
  statusCategory: string;
  updatedAt: unknown;
  assignee: string;
  correspondent: string;
  tags: Array<{ id: string; name: string }>;
  inboxes: Array<{ id: string; name: string }>;
  preview: string;
  link: string | null;
};

export function compactConversation(value: unknown): CompactFrontConversation {
  const conversation = record(value);
  const lastMessage = record(conversation.last_message);
  const recipient = record(conversation.recipient);
  const tags = Array.isArray(conversation.tags) ? conversation.tags : [];
  const inboxes = Array.isArray(conversation.inboxes)
    ? conversation.inboxes
    : [];
  const id = text(conversation.id);
  return {
    id,
    subject: text(conversation.subject) || "(no subject)",
    status: text(conversation.status),
    statusCategory: text(conversation.status_category),
    updatedAt:
      conversation.updated_at ??
      lastMessage.created_at ??
      conversation.created_at ??
      null,
    assignee: personLabel(conversation.assignee),
    correspondent:
      personLabel(recipient) ||
      personLabel(lastMessage.author) ||
      text(recipient.handle),
    tags: tags
      .map((tag) => {
        const item = record(tag);
        return { id: text(item.id), name: text(item.name) };
      })
      .filter((tag) => tag.id || tag.name),
    inboxes: inboxes
      .map((inbox) => {
        const item = record(inbox);
        return { id: text(item.id), name: text(item.name) };
      })
      .filter((inbox) => inbox.id || inbox.name),
    preview: (
      text(lastMessage.blurb) ||
      text(lastMessage.body) ||
      text(conversation.blurb)
    )
      .replace(/\s+/g, " ")
      .slice(0, 240),
    link: /^cnv_[a-zA-Z0-9]+$/.test(id)
      ? `https://app.frontapp.com/open/${id}`
      : null,
  };
}

export function textField(value: unknown): string {
  return text(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return record(value);
}
