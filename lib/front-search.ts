// Front conversation search, entirely through Front's official hosted MCP.
//
// Tagged inventory prefers Core REST GET /tags/{id}/conversations (the full tag
// list; MCP search_conversations wraps inbox-scoped Search and under-counts
// no-inbox discussions). When Core REST can't reach a tag — e.g. a private tag
// the OAuth app's namespace access excludes — it falls back to the official MCP
// search_conversations tool, which acts as the authorizing teammate. Pipedream
// is no longer used for Front.

import {
  asRecord,
  buildFrontSearchQuery,
  buildTagConversationsPath,
  buildTagConversationsPathOptions,
  buildTaggedOpenQuery,
  compactConversation,
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  FRONT_API_BASE,
  FRONTAPP_PIPEDREAM_SLUG,
  normalizeFrontSearchStatus,
  normalizeFrontTagId,
  normalizeFrontTeammateId,
  pageTokenFromNext,
  resolveExactTag,
  resultsFrom,
  textField,
  type CompactFrontConversation,
  type FrontSearchStatus,
} from "@/lib/front-search-helpers";

export {
  buildFrontSearchQuery,
  buildOpenSearchQuery,
  buildTagConversationsPath,
  buildTagOpenConversationsPath,
  buildTaggedOpenQuery,
  compactConversation,
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  FRONT_API_BASE,
  FRONTAPP_PIPEDREAM_SLUG,
  normalizeFrontSearchStatus,
  normalizeFrontTagId,
  normalizeFrontTeammateId,
  pageTokenFromNext,
  resolveExactTag,
  resultsFrom,
  textField,
  type CompactFrontConversation,
  type FrontSearchStatus,
} from "@/lib/front-search-helpers";

/** Front ACL denials on private tags / insufficient OAuth agent scopes. */
function isFrontTagConversationsPermissionDenied(detail: string): boolean {
  return /403|forbidden|permission denial|do not have access to the resources of this teammate|not allowed to read/i.test(
    detail,
  );
}

function formatTagConversationsEmptyError(
  tagId: string,
  attemptCount: number,
  errors: string[],
): Error {
  const joined = errors.join(" ");
  const sample = errors.slice(0, 2).join(" | ") || "no error detail";
  if (/not allowed to read.*tag/i.test(joined)) {
    return new Error(
      `Front denied reading tag ${tagId} ("This agent is not allowed to read the tag"). ` +
        `That tag is private/restricted and your Front OAuth app's Namespace access can't reach it. ` +
        `Either convert it to a company/shared tag in Front, or enable Shared + Private resources under the ` +
        `Front app's Namespace access (with Tags → Read) and reconnect Front. ${sample}`,
    );
  }
  if (isFrontTagConversationsPermissionDenied(joined)) {
    return new Error(
      `Front Core API returned 403 for /tags/${tagId}/conversations after ${attemptCount} attempt(s). ` +
        `Enable the needed Resource/Namespace access on your Front OAuth app and reconnect Front. ${sample}`,
    );
  }
  return new Error(
    `No conversations from /tags/${tagId}/conversations after ${attemptCount} encoding(s). ${sample}`,
  );
}

type FrontGet = (pathWithQuery: string) => Promise<unknown>;

/** Merge unique conversations across Front's finicky /tags/{id}/conversations encodings. */
async function collectTagConversations(opts: {
  get: FrontGet;
  tagId: string;
  limit: number;
  cursor?: string;
  status: FrontSearchStatus;
}): Promise<{
  conversations: CompactFrontConversation[];
  nextCursor: string | null;
  reportedTotal?: number;
  bestPageCount: number;
  errors: string[];
  bestPath: string;
}> {
  const paths = buildTagConversationsPathOptions(
    opts.tagId,
    opts.limit,
    opts.cursor,
    opts.status,
  );
  const byId = new Map<string, CompactFrontConversation>();
  const errors: string[] = [];
  let bestPath = "";
  let nextCursor: string | null = null;
  let reportedTotal: number | undefined;
  let bestPageCount = -1;

  for (const path of paths) {
    try {
      const response = await opts.get(path);
      const envelope = asRecord(response);
      const page = resultsFrom(response).map(compactConversation);
      for (const c of page) {
        if (c.id && !byId.has(c.id)) byId.set(c.id, c);
      }
      if (page.length > bestPageCount) {
        bestPageCount = page.length;
        bestPath = path;
        nextCursor = pageTokenFromNext(asRecord(envelope._pagination).next);
        if (typeof envelope._total === "number") {
          reportedTotal = envelope._total;
        }
      }
      if (byId.size > 0 && path === paths[0]) break;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "request failed";
      errors.push(`${path}: ${detail}`.slice(0, 180));
    }
  }

  if (byId.size === 0) {
    throw formatTagConversationsEmptyError(opts.tagId, paths.length, errors);
  }

  let pages = 1;
  while (nextCursor && byId.size < 200 && pages < 10 && bestPath) {
    const paginatedPath = bestPath.includes("page_token=")
      ? bestPath.replace(
          /page_token=[^&]+/,
          `page_token=${encodeURIComponent(nextCursor)}`,
        )
      : `${bestPath}${bestPath.includes("?") ? "&" : "?"}page_token=${encodeURIComponent(nextCursor)}`;
    try {
      const response = await opts.get(paginatedPath);
      const envelope = asRecord(response);
      for (const c of resultsFrom(response).map(compactConversation)) {
        if (c.id && !byId.has(c.id)) byId.set(c.id, c);
      }
      nextCursor = pageTokenFromNext(asRecord(envelope._pagination).next);
      pages += 1;
    } catch {
      break;
    }
  }

  return {
    conversations: [...byId.values()],
    nextCursor,
    reportedTotal,
    bestPageCount,
    errors,
    bestPath,
  };
}

/** Resolve a tag id without calling Front — explicit id or Config inbox-zero id. */
async function resolveTagIdWithoutProxy(input: {
  tagId?: string;
  tagName?: string;
}): Promise<{ id: string; name: string; scope: "explicit" } | null> {
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
  const { getAppSettings } = await import("@/lib/settings");
  const settings = await getAppSettings().catch(() => null);
  const fromSettings = textField(settings?.["front.inbox_zero_tag_id"]);
  if (
    fromSettings &&
    requestedName.toLowerCase() === DEFAULT_FRONT_INBOX_ZERO_TAG.toLowerCase()
  ) {
    return {
      id: normalizeFrontTagId(fromSettings),
      name: requestedName,
      scope: "explicit",
    };
  }
  return null;
}

async function searchTaggedViaOfficialCore(
  input: FrontSearchInput,
): Promise<FrontSearchResult> {
  const tag = await resolveTagIdWithoutProxy(input);
  if (!tag) {
    throw new Error(
      "Pass tag_id or set Config front.inbox_zero_tag_id before using Front Core tag listing.",
    );
  }
  const limitRaw =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.trunc(input.limit)
      : 25;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const status = normalizeFrontSearchStatus(input.status);
  const { frontCoreGet } = await import("@/lib/front-core-api");
  const collected = await collectTagConversations({
    get: frontCoreGet,
    tagId: tag.id,
    limit,
    cursor: textField(input.cursor) || undefined,
    status,
  });
  const tagListQuery =
    status === "open"
      ? `tag:${tag.id} statuses:assigned,unassigned`
      : status === "all"
        ? `tag:${tag.id}`
        : `tag:${tag.id} is:${status}`;
  return {
    query: tagListQuery,
    source: "tag_conversations",
    filters: { tag, status },
    account: "Front",
    count: collected.conversations.length,
    ...(collected.reportedTotal !== undefined
      ? {
          total: Math.max(
            collected.reportedTotal,
            collected.conversations.length,
          ),
        }
      : { total: collected.conversations.length }),
    conversations: collected.conversations,
    nextCursor: collected.nextCursor,
    hasMore: Boolean(collected.nextCursor),
    note: `Used official Front OAuth + GET /tags/{id}/conversations (${collected.conversations.length} unique; best page had ${collected.bestPageCount}; ${collected.errors.length} encoding(s) failed).`,
  };
}

export type FrontSearchInput = {
  /** Exact tag name. Optional — omit to inventory all open conversations. */
  tagName?: string;
  /**
   * Front Core API tag id (`tag_…`). Prefer this (or Config
   * `front.inbox_zero_tag_id`) when private-tag listing is blocked.
   */
  tagId?: string;
  /**
   * Status scope. Default `open` (assigned+unassigned on tag list /
   * `is:open` on Search). Pass `all` for every non-trashed status — needed
   * for discussions that sit outside any inbox.
   */
  status?: FrontSearchStatus | string;
  /** Teammate name, email, or tea_ id for assignee: filter. Optional. */
  assignee?: string;
  /** Teammate name, email, or tea_ id for participant: filter. Optional. */
  participant?: string;
  /**
   * Teammate that owns private tags / personal resources. Defaults to the
   * Front teammate behind the Pipedream OAuth grant (GET /me).
   */
  teammate?: string;
  limit?: number;
  cursor?: string;
  /**
   * When false, do not fall back to inbox-scoped Search / MCP after
   * /tags/{id}/conversations fails (Inbox page must not silently under-count).
   */
  allowSearchFallback?: boolean;
};

export type FrontSearchResult = {
  query: string;
  source: "search" | "tag_conversations" | "mcp_list_filter" | "mcp_search";
  filters: {
    tag?: {
      id: string;
      name: string;
      scope?: "company" | "teammate" | "explicit";
    };
    status?: FrontSearchStatus;
    assignee?: { id: string; name: string };
    participant?: { id: string; name: string };
    teammate?: { id: string; name: string };
  };
  account: string;
  count: number;
  total?: number;
  conversations: CompactFrontConversation[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Present when MCP fallback was used after Connect Proxy failed. */
  proxyError?: string;
  note?: string;
  /** Tag names seen on the MCP recent-open page (fallback only). */
  sampleTags?: string[];
};

/** One compact page of Front conversations matching optional filters. */
export async function searchFrontConversations(
  input: FrontSearchInput = {},
): Promise<FrontSearchResult> {
  const wantsTag = Boolean(textField(input.tagId) || textField(input.tagName));
  if (wantsTag) {
    // Front runs entirely through its official hosted MCP now — no Pipedream.
    // Prefer Core REST GET /tags/{id}/conversations for the full tag inventory
    // (MCP search_conversations wraps inbox-scoped Search and under-counts
    // no-inbox discussions). If Core REST is unavailable — e.g. a private tag
    // the OAuth app's namespace access can't reach — fall back to the official
    // MCP search_conversations tool, which acts with the authorizing teammate's
    // own access. That may under-count no-inbox discussions, so we say so.
    try {
      return await searchTaggedViaOfficialCore(input);
    } catch (coreError) {
      const coreDetail =
        coreError instanceof Error ? coreError.message : "failed";
      const { searchFrontConversationsViaOfficialMcp } = await import(
        "@/lib/front-mcp-read"
      );
      try {
        const mcp = await searchFrontConversationsViaOfficialMcp(input);
        return {
          ...mcp,
          note:
            `${mcp.note ?? "Used Front official MCP search_conversations."} ` +
            `The full tag inventory (GET /tags/{id}/conversations) was unavailable, so this may ` +
            `under-count no-inbox discussions. To restore full fidelity, enable Shared + Private ` +
            `resources under your Front OAuth app's Namespace access and reconnect Front. (${coreDetail})`,
          proxyError: coreDetail,
        };
      } catch (mcpError) {
        throw new Error(
          `Front tagged inventory failed via Core REST (${coreDetail}) and official MCP ` +
            `(${mcpError instanceof Error ? mcpError.message : "failed"}).`,
        );
      }
    }
  }

  // No tag filter: official MCP search_conversations only — no Pipedream.
  const { searchFrontConversationsViaOfficialMcp } = await import(
    "@/lib/front-mcp-read"
  );
  return await searchFrontConversationsViaOfficialMcp(input);
}

/** Convenience alias that defaults the Chief Inbox Zero tag name. */
export async function searchTaggedOpenConversations(input: {
  tagName?: string;
  tagId?: string;
  status?: FrontSearchStatus | string;
  teammate?: string;
  limit?: number;
  cursor?: string;
}): Promise<FrontSearchResult> {
  return searchFrontConversations({
    tagName: textField(input.tagName) || DEFAULT_FRONT_INBOX_ZERO_TAG,
    tagId: input.tagId,
    status: input.status,
    teammate: input.teammate,
    limit: input.limit,
    cursor: input.cursor,
    allowSearchFallback: false,
  });
}

/** Read one conversation through Front's official MCP timeline tool. */
export async function getFrontConversationById(
  conversationId: string,
): Promise<CompactFrontConversation & { body: string }> {
  const { getFrontConversationViaOfficialMcp } = await import(
    "@/lib/front-mcp-read"
  );
  return getFrontConversationViaOfficialMcp(conversationId);
}
