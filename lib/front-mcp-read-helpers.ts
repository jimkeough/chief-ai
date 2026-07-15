// Pure helpers for Front's official MCP response and argument shapes.

import {
  asRecord,
  compactConversation,
  normalizeFrontSearchStatus,
  normalizeFrontTagId,
  pageTokenFromNext,
  resultsFrom,
  textField,
  type CompactFrontConversation,
  type FrontSearchStatus,
} from "./front-search-helpers.ts";

export function parseFrontMcpJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error("Front MCP returned an unexpected non-JSON response.");
  }
}

export function buildFrontMcpSearchArgs(input: {
  tagId?: string;
  status?: FrontSearchStatus | string;
  assigneeId?: string;
  participant?: string;
  cursor?: string;
}): Record<string, unknown> {
  if (textField(input.participant)) {
    throw new Error(
      "Front's official MCP does not support participant filtering. Use a tag or assignee.",
    );
  }
  const status = normalizeFrontSearchStatus(input.status);
  if (!["open", "all", "archived", "trashed"].includes(status)) {
    throw new Error(
      `Front's official MCP cannot filter status "${status}". Use open, all, archived, or trashed.`,
    );
  }
  const filters: Record<string, unknown> = {};
  if (input.tagId) filters.tags = [normalizeFrontTagId(input.tagId)];
  if (status !== "all") filters.status = status;
  if (input.assigneeId) {
    const teammateId = textField(input.assigneeId);
    if (!/^tea_[a-zA-Z0-9]+$/.test(teammateId)) {
      throw new Error("Front assignee must be a tea_… teammate id.");
    }
    filters.teammateId = teammateId;
  }
  const args: Record<string, unknown> = {
    scope: "all_inboxes",
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  };
  const cursor = textField(input.cursor);
  if (cursor) args.cursor = cursor;
  return args;
}

function nestedRecords(value: unknown): Record<string, unknown>[] {
  const root = asRecord(value);
  return [
    root,
    asRecord(root.data),
    asRecord(root.body),
    asRecord(root.result),
    asRecord(root.response),
  ];
}

export function frontMcpNextCursor(value: unknown): string | null {
  for (const record of nestedRecords(value)) {
    const direct =
      textField(record.nextCursor) ||
      textField(record.next_cursor) ||
      textField(record.nextPageCursor);
    if (direct) return direct;
    const pagination = asRecord(record.pagination ?? record._pagination);
    const nested =
      textField(pagination.nextCursor) ||
      textField(pagination.next_cursor) ||
      pageTokenFromNext(pagination.next);
    if (nested) return nested;
  }
  return null;
}

export function frontMcpTotal(value: unknown): number | undefined {
  for (const record of nestedRecords(value)) {
    for (const candidate of [record.total, record._total, record.count]) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function frontMcpConversations(value: unknown): CompactFrontConversation[] {
  return resultsFrom(value)
    .map(compactConversation)
    .filter((conversation) => /^cnv_[a-zA-Z0-9]+$/.test(conversation.id));
}

function timelineFrom(value: unknown): unknown[] {
  for (const record of nestedRecords(value)) {
    for (const key of ["timeline", "entries", "events", "messages"] as const) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

function entryBody(value: unknown): string {
  const entry = asRecord(value);
  const nested = asRecord(entry.message ?? entry.comment ?? entry.data);
  const body =
    textField(entry.body) ||
    textField(entry.text) ||
    textField(entry.content) ||
    textField(entry.blurb) ||
    textField(nested.body) ||
    textField(nested.text) ||
    textField(nested.content) ||
    textField(nested.blurb);
  return body.replace(/\s+/g, " ").trim();
}

export function frontMcpConversationDetail(
  value: unknown,
): CompactFrontConversation & { body: string } {
  const records = nestedRecords(value);
  const root = records[0];
  const conversation =
    asRecord(root.conversation).id || asRecord(root.conversation).subject
      ? asRecord(root.conversation)
      : records.find((record) => textField(record.id).startsWith("cnv_")) ?? root;
  const timeline = timelineFrom(value);
  const latest = [...timeline].reverse().find((entry) => entryBody(entry));
  const body = latest ? entryBody(latest) : textField(conversation.body);
  const latestRecord = asRecord(latest);
  const latestNested = asRecord(
    latestRecord.message ?? latestRecord.comment ?? latestRecord.data,
  );
  const compact = compactConversation({
    ...conversation,
    last_message: {
      ...latestNested,
      body,
      author: latestNested.author ?? latestRecord.author,
      created_at:
        latestNested.created_at ??
        latestNested.createdAt ??
        latestRecord.created_at ??
        latestRecord.createdAt,
    },
    preview: body,
  });
  return { ...compact, body: body || compact.preview };
}
