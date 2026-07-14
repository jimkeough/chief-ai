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

/** Build a Front search query from resolved filter IDs. Always scopes to open. */
export function buildOpenSearchQuery(filters: {
  tagId?: string;
  inboxId?: string;
  assigneeId?: string;
  participantId?: string;
}): string {
  const parts: string[] = ["is:open"];
  const tagId = text(filters.tagId);
  const inboxId = text(filters.inboxId);
  const assigneeId = text(filters.assigneeId);
  const participantId = text(filters.participantId);
  if (tagId) {
    if (!/^tag_[a-zA-Z0-9]+$/.test(tagId)) {
      throw new Error("Front returned an invalid tag ID.");
    }
    parts.push(`tag:${tagId}`);
  }
  if (inboxId) {
    if (!/^inb_[a-zA-Z0-9]+$/.test(inboxId)) {
      throw new Error("Front returned an invalid inbox ID.");
    }
    parts.push(`inbox:${inboxId}`);
  }
  if (assigneeId) {
    if (!/^tea_[a-zA-Z0-9]+$/.test(assigneeId)) {
      throw new Error("Front returned an invalid teammate ID.");
    }
    parts.push(`assignee:${assigneeId}`);
  }
  if (participantId) {
    if (!/^tea_[a-zA-Z0-9]+$/.test(participantId)) {
      throw new Error("Front returned an invalid teammate ID.");
    }
    parts.push(`participant:${participantId}`);
  }
  return parts.join(" ");
}

export function resolveExactNamedResource(
  matches: unknown[],
  requestedName: string,
  kind: string,
): { id: string; name: string } {
  const exact = matches.filter((item) => text(record(item).name) === requestedName);
  const candidates = exact.length ? exact : matches;
  if (candidates.length === 0) {
    throw new Error(`Front ${kind} "${requestedName}" was not found.`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `More than one Front ${kind} is named "${requestedName}". Rename the target so it is unique.`,
    );
  }
  const item = record(candidates[0]);
  const id = text(item.id);
  const name = text(item.name);
  if (!id || !name) {
    throw new Error(`Front ${kind} "${requestedName}" was incomplete.`);
  }
  return { id, name };
}

export function resolveExactTag(
  matches: unknown[],
  requestedName: string,
): { id: string; name: string } {
  return resolveExactNamedResource(matches, requestedName, "tag");
}

export function teammateLabel(value: unknown): string {
  const person = record(value);
  return (
    text(person.name) ||
    `${text(person.first_name)} ${text(person.last_name)}`.trim() ||
    text(person.email) ||
    text(person.username) ||
    text(person.handle)
  );
}

export function teammateMatches(value: unknown, requested: string): boolean {
  const needle = normalizeFrontTeammateId(requested).toLowerCase();
  if (!needle) return false;
  const person = record(value);
  const id = text(person.id).toLowerCase();
  if (id && id === needle) return true;
  const labels = [
    text(person.name),
    `${text(person.first_name)} ${text(person.last_name)}`.trim(),
    text(person.email),
    text(person.username),
  ]
    .map((label) => label.toLowerCase())
    .filter(Boolean);
  return labels.some((label) => label === needle || label.includes(needle));
}

/** Front UI sometimes uses tea:123; Core API expects tea_123. */
export function normalizeFrontTeammateId(raw: string): string {
  const value = text(raw);
  if (/^tea:[a-zA-Z0-9]+$/.test(value)) return `tea_${value.slice(4)}`;
  return value;
}

export function nameMatchesIgnoreCase(actual: unknown, requested: string): boolean {
  return text(actual).toLowerCase() === text(requested).toLowerCase();
}

/** Path for open (assigned+unassigned) conversations on a tag. */
export function buildTagOpenConversationsPath(
  tagId: string,
  limit: number,
  cursor?: string,
): string {
  const id = text(tagId);
  if (!/^tag_[a-zA-Z0-9]+$/.test(id)) {
    throw new Error("Front returned an invalid tag ID.");
  }
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  if (cursor) qs.set("page_token", cursor);
  // Front's Open tab ≈ assigned + unassigned (excludes archived/trashed/snoozed).
  qs.append("q[statuses][]", "assigned");
  qs.append("q[statuses][]", "unassigned");
  return `/tags/${encodeURIComponent(id)}/conversations?${qs}`;
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
    assignee: teammateLabel(conversation.assignee),
    correspondent:
      teammateLabel(recipient) ||
      teammateLabel(lastMessage.author) ||
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
