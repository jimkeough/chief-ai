const text = (value) => (typeof value === "string" ? value.trim() : "");
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export function resultsFrom(response) {
  if (Array.isArray(response)) return response;
  return Array.isArray(response?._results) ? response._results : [];
}

export function pageTokenFromNext(next) {
  const value = text(next);
  if (!value) return null;
  try {
    return new URL(value).searchParams.get("page_token");
  } catch {
    return value;
  }
}

export function buildTaggedOpenQuery(tagId) {
  const id = text(tagId);
  if (!/^tag_[a-zA-Z0-9]+$/.test(id)) {
    throw new Error("Front returned an invalid tag ID.");
  }
  return `tag:${id} is:open`;
}

export function resolveExactTag(matches, requestedName) {
  const exact = matches.filter(
    (tag) => text(tag?.name) === requestedName,
  );
  const candidates = exact.length ? exact : matches;
  if (candidates.length === 0) {
    throw new Error(`Front tag "${requestedName}" was not found.`);
  }
  if (candidates.length > 1) {
    throw new Error(
      `More than one Front tag is named "${requestedName}". Rename the target tag so it is unique.`,
    );
  }
  return candidates[0];
}

function personLabel(value) {
  const person = record(value);
  return (
    text(person.name) ||
    `${text(person.first_name)} ${text(person.last_name)}`.trim() ||
    text(person.email) ||
    text(person.handle)
  );
}

export function compactConversation(value) {
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
