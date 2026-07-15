// Application-owned reads against Front's official MCP tools. Chief chat and
// the Front Inbox share this path so neither depends on Pipedream's proxy.

import { callMcpTool, listMcpTools } from "@/lib/mcp-broker";
import { frontMcpServer } from "@/lib/front-mcp";
import {
  buildFrontMcpSearchArgs,
  frontMcpConversationDetail,
  frontMcpConversations,
  frontMcpNextCursor,
  frontMcpTotal,
  parseFrontMcpJson,
} from "@/lib/front-mcp-read-helpers";
import {
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  normalizeFrontSearchStatus,
  normalizeFrontTagId,
  resolveExactTag,
  teammateLabel,
  teammateMatches,
  textField,
  type CompactFrontConversation,
} from "@/lib/front-search-helpers";
import { getAppSettings } from "@/lib/settings";
import type {
  FrontSearchInput,
  FrontSearchResult,
} from "@/lib/front-search";

async function requireOfficialFront() {
  const server = await frontMcpServer();
  if (!server) {
    throw new Error(
      "Connect Front official MCP in Settings → Connections first.",
    );
  }
  return server;
}

async function callFrontRead(tool: string, args: Record<string, unknown>) {
  const server = await requireOfficialFront();
  const tools = await listMcpTools(server);
  const definition = tools.find((candidate) => candidate.name === tool);
  if (!definition?.readOnly) {
    throw new Error(
      `Front MCP did not expose ${tool} as a verified read. Check the Front app's MCP Server feature and read permission.`,
    );
  }
  const response = await callMcpTool(server, tool, args);
  return { server, value: parseFrontMcpJson(response) };
}

async function resolveTag(input: FrontSearchInput): Promise<{
  id: string;
  name: string;
  scope: "explicit";
} | null> {
  const explicit = textField(input.tagId);
  const requestedName =
    textField(input.tagName) || DEFAULT_FRONT_INBOX_ZERO_TAG;
  if (explicit) {
    return {
      id: normalizeFrontTagId(explicit),
      name: requestedName,
      scope: "explicit",
    };
  }

  const settings = await getAppSettings().catch(() => null);
  const saved = textField(settings?.["front.inbox_zero_tag_id"]);
  if (
    saved &&
    requestedName.toLowerCase() === DEFAULT_FRONT_INBOX_ZERO_TAG.toLowerCase()
  ) {
    return {
      id: normalizeFrontTagId(saved),
      name: requestedName,
      scope: "explicit",
    };
  }
  if (!textField(input.tagName)) return null;

  const { value } = await callFrontRead("list_tags", {
    name_query: requestedName,
    limit: 100,
    offset: 0,
  });
  const candidates = (() => {
    const envelope =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    if (Array.isArray(value)) return value;
    if (Array.isArray(envelope.tags)) return envelope.tags;
    if (Array.isArray(envelope.results)) return envelope.results;
    if (Array.isArray(envelope._results)) return envelope._results;
    return [];
  })().filter((tag) => {
    const record =
      tag && typeof tag === "object" ? (tag as Record<string, unknown>) : {};
    return textField(record.name).toLowerCase() === requestedName.toLowerCase();
  });
  const tag = resolveExactTag(candidates, requestedName);
  return { ...tag, scope: "explicit" };
}

async function resolveAssignee(input: FrontSearchInput): Promise<{
  id: string;
  name: string;
} | null> {
  const requested = textField(input.assignee);
  if (!requested) return null;
  if (/^tea_[a-zA-Z0-9]+$/.test(requested)) {
    return { id: requested, name: requested };
  }
  const { value } = await callFrontRead("list_teammates", {
    name_query: requested,
    statuses: ["active"],
    limit: 25,
    offset: 0,
  });
  const envelope =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const candidates = (
    Array.isArray(value)
      ? value
      : Array.isArray(envelope.teammates)
        ? envelope.teammates
        : Array.isArray(envelope.results)
          ? envelope.results
          : []
  ).filter((candidate) => teammateMatches(candidate, requested));
  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? `Front teammate "${requested}" was not found.`
        : `More than one Front teammate matches "${requested}". Use their tea_… id.`,
    );
  }
  const record = candidates[0] as Record<string, unknown>;
  const id = textField(record.id);
  if (!/^tea_[a-zA-Z0-9]+$/.test(id)) {
    throw new Error(`Front teammate "${requested}" returned an invalid id.`);
  }
  return { id, name: teammateLabel(record) || id };
}

export async function searchFrontConversationsViaOfficialMcp(
  input: FrontSearchInput = {},
): Promise<FrontSearchResult> {
  const [tag, assignee] = await Promise.all([
    resolveTag(input),
    resolveAssignee(input),
  ]);
  const status = normalizeFrontSearchStatus(input.status);
  const args = buildFrontMcpSearchArgs({
    tagId: tag?.id,
    status,
    assigneeId: assignee?.id,
    participant: input.participant,
    cursor: input.cursor,
  });
  const { server, value } = await callFrontRead("search_conversations", args);
  const conversations = frontMcpConversations(value);
  const nextCursor = frontMcpNextCursor(value);
  const total = frontMcpTotal(value);
  return {
    query: JSON.stringify(args),
    source: "mcp_search",
    filters: {
      status,
      ...(tag ? { tag } : {}),
      ...(assignee ? { assignee } : {}),
    },
    account: server.accountLabel ?? "Front",
    count: conversations.length,
    ...(total !== undefined ? { total } : {}),
    conversations,
    nextCursor,
    hasMore: Boolean(nextCursor),
    note:
      input.limit && input.limit < conversations.length
        ? `Front MCP controls page size; returned ${conversations.length} conversations.`
        : "Used Front official MCP search_conversations.",
  };
}

export async function getFrontConversationViaOfficialMcp(
  conversationId: string,
): Promise<CompactFrontConversation & { body: string }> {
  const id = textField(conversationId);
  if (!/^cnv_[a-zA-Z0-9]+$/.test(id)) {
    throw new Error(`Front conversation id must look like cnv_… (got "${id}").`);
  }
  const { value } = await callFrontRead("read_conversation", {
    conversationId: id,
    limit: 200,
  });
  return frontMcpConversationDetail(value);
}
