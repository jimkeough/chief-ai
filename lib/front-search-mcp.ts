// MCP-backed Front inventory — same path as Inbox UI / working Pipedream MCP
// tools. Used when Connect Proxy / Front Search API fails.

import {
  listOpenFrontConversations,
  type FrontConversation,
} from "@/lib/front-inbox";
import {
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  textField,
  type CompactFrontConversation,
} from "@/lib/front-search-helpers";

export type FrontMcpSearchResult = {
  query: string;
  source: "mcp_list_filter";
  proxyError: string;
  note: string;
  sampleTags: string[];
  filters: {
    tag?: { name: string };
    teammate?: { id: string; name: string };
  };
  account: string;
  count: number;
  conversations: CompactFrontConversation[];
  nextCursor: null;
  hasMore: false;
};

function toCompact(c: FrontConversation): CompactFrontConversation {
  return {
    id: c.id,
    subject: c.subject,
    status: c.status,
    statusCategory: c.status,
    updatedAt: c.updatedAt,
    assignee: "",
    correspondent: c.correspondent,
    tags: c.tags.map((name) => ({ id: "", name })),
    inboxes: [],
    preview: c.preview,
    link: c.link,
  };
}

/** Recent open Front conversations via Pipedream MCP, optionally filtered by tag name. */
export async function searchFrontConversationsViaMcp(input: {
  tagName?: string;
  teammate?: string;
  proxyError: string;
}): Promise<FrontMcpSearchResult> {
  const listed = await listOpenFrontConversations();
  if (!listed.connected) {
    throw new Error("Front is not connected through Pipedream MCP.");
  }
  if ("error" in listed) {
    throw new Error(listed.error);
  }

  const tagName = textField(input.tagName);
  const sampleTags = [
    ...new Set(listed.conversations.flatMap((c) => c.tags).filter(Boolean)),
  ].slice(0, 25);

  let conversations = listed.conversations;
  if (tagName) {
    const needle = tagName.toLowerCase();
    conversations = conversations.filter((c) =>
      c.tags.some((t) => t.toLowerCase() === needle),
    );
  }

  // Oldest first for triage.
  conversations = [...conversations].sort((a, b) =>
    (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""),
  );

  return {
    query: tagName
      ? `mcp list-conversations filter tag:${tagName}`
      : "mcp list-conversations open",
    source: "mcp_list_filter",
    proxyError: input.proxyError,
    note:
      "Front Connect Proxy failed, so this used Pipedream MCP list-conversations (all_inboxes / open). That path misses no-inbox discussions — use GET /tags/{id}/conversations via proxy when available. sampleTags lists tag names seen on that page.",
    sampleTags,
    filters: {
      ...(tagName ? { tag: { name: tagName } } : {}),
      ...(textField(input.teammate)
        ? {
            teammate: {
              id: textField(input.teammate),
              name: textField(input.teammate),
            },
          }
        : {}),
    },
    account: listed.account ?? "Front",
    count: conversations.length,
    conversations: conversations.map(toCompact),
    nextCursor: null,
    hasMore: false,
  };
}

export function defaultTagForMcpAlias(tagName?: string): string {
  return textField(tagName) || DEFAULT_FRONT_INBOX_ZERO_TAG;
}
