// Front conversation search via Pipedream Connect API Proxy.
//
// Pipedream MCP exposes prebuilt Front actions; list-conversations cannot
// filter by tag/inbox/assignee. When a managed action is missing, Chief calls
// Front's Core API through Connect Proxy with the owner's existing Front OAuth
// grant — no Front token in Chief.
//
// Individual (private) tags live under /teammates/{id}/tags, not only /tags.
// Admins who create personal tags like "Chief Inbox Zero" must be resolved via
// GET /me (or an explicit teammate id) before tag search works.

import { createClient } from "@/lib/supabase/server";
import {
  findPipedreamConnectionByApp,
  pipedreamProxyRequest,
} from "@/lib/pipedream";
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
  nameMatchesIgnoreCase,
  normalizeFrontSearchStatus,
  normalizeFrontTagId,
  normalizeFrontTeammateId,
  pageTokenFromNext,
  resolveExactTag,
  resultsFrom,
  teammateLabel,
  teammateMatches,
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

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Sign in to search Front.");
  return user.id;
}

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
        `Pipedream's default Front OAuth app usually lacks Private Resources — reconnecting alone will not help. ` +
        `Either convert the tag to company/shared in Front, or: create a Front developer OAuth app with Private Resources + Tags read, ` +
        `add it as a Pipedream OAuth Client for Front, set Config → Pipedream — Front OAuth app id (oa_…), then disconnect and reconnect Front. ${sample}`,
    );
  }
  if (isFrontTagConversationsPermissionDenied(joined)) {
    return new Error(
      `Connect Proxy returned 403 for /tags/${tagId}/conversations after ${attemptCount} attempt(s) ` +
        `(relative and absolute). Reconnect Front in Config → Connections, or run diagnose_pipedream_connect. ${sample}`,
    );
  }
  return new Error(
    `No conversations from /tags/${tagId}/conversations after ${attemptCount} encoding(s). ${sample}`,
  );
}

async function frontProxyGet(
  userId: string,
  accountId: string,
  pathWithQuery: string,
  opts?: { absoluteFallback?: boolean; preferAbsolute?: boolean },
): Promise<unknown> {
  const path = pathWithQuery.startsWith("/")
    ? pathWithQuery
    : `/${pathWithQuery}`;
  const absolute = `${FRONT_API_BASE}${path}`;
  const relativeFirst = !opts?.preferAbsolute;

  const tryRelative = () =>
    pipedreamProxyRequest(userId, {
      accountId,
      method: "GET",
      url: path,
    });
  const tryAbsolute = () =>
    pipedreamProxyRequest(userId, {
      accountId,
      method: "GET",
      url: absolute,
    });

  if (relativeFirst) {
    try {
      return await tryRelative();
    } catch (relativeError) {
      if (opts?.absoluteFallback === false) throw relativeError;
      try {
        return await tryAbsolute();
      } catch {
        throw relativeError;
      }
    }
  }

  // Tag conversation lists: absolute api2 first (relative often 403s falsely).
  try {
    return await tryAbsolute();
  } catch (absoluteError) {
    try {
      return await tryRelative();
    } catch {
      throw absoluteError;
    }
  }
}

async function paginateCollection(
  userId: string,
  accountId: string,
  path: string,
  pick: (item: unknown) => boolean,
): Promise<unknown[]> {
  const matches: unknown[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (pageToken) qs.set("page_token", pageToken);
    const response = await frontProxyGet(userId, accountId, `${path}?${qs}`);
    for (const item of resultsFrom(response)) {
      if (pick(item)) matches.push(item);
    }
    const pagination = asRecord(asRecord(response)._pagination);
    pageToken = pageTokenFromNext(pagination.next);
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new Error(`Front repeated a pagination cursor for ${path}.`);
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);
  return matches;
}

async function fetchFrontMe(
  userId: string,
  accountId: string,
): Promise<{ id: string; name: string }> {
  const raw = await frontProxyGet(userId, accountId, "/me");
  // Connect Proxy sometimes returns the teammate object directly, sometimes
  // nested under data / body.
  const candidates = [asRecord(raw), asRecord(asRecord(raw).data), asRecord(asRecord(raw).body)];
  for (const me of candidates) {
    const id = normalizeFrontTeammateId(textField(me.id));
    if (!/^tea_[a-zA-Z0-9]+$/.test(id)) continue;
    const name = teammateLabel(me) || textField(me.email) || id;
    return { id, name };
  }
  throw new Error("Front did not return the authorizing teammate id (/me).");
}

/** Prefer an explicit tea_ id without another Front round-trip. */
function teammateFromIdHint(hint: string): { id: string; name: string } | null {
  const id = normalizeFrontTeammateId(hint);
  if (!/^tea_[a-zA-Z0-9]+$/.test(id)) return null;
  return { id, name: id };
}

async function resolveOwnerTeammate(
  userId: string,
  accountId: string,
  hint: string,
): Promise<{ id: string; name: string }> {
  const fromHint = textField(hint);
  if (fromHint) {
    const direct = teammateFromIdHint(fromHint);
    if (direct) return direct;
    return resolveTeammate(userId, accountId, fromHint);
  }

  const { getAppSettings } = await import("@/lib/settings");
  const settings = await getAppSettings().catch(() => null);
  const fromSettings = textField(settings?.["front.teammate_id"]);
  if (fromSettings) {
    const direct = teammateFromIdHint(fromSettings);
    if (direct) return direct;
    return resolveTeammate(userId, accountId, fromSettings);
  }

  try {
    return await fetchFrontMe(userId, accountId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "failed";
    throw new Error(
      `Could not resolve Front teammate identity (${detail}). Set Config → Front — teammate id to your tea_… id (e.g. tea_lm2n2 for jim@homejab.com), or pass teammate in the tool call.`,
    );
  }
}

async function resolveTagByName(
  userId: string,
  accountId: string,
  requestedName: string,
  teammateId: string,
): Promise<{ id: string; name: string; scope: "company" | "teammate" }> {
  const pickName = (tag: unknown) =>
    nameMatchesIgnoreCase(asRecord(tag).name, requestedName);

  let companyError: string | null = null;
  try {
    const companyMatches = await paginateCollection(
      userId,
      accountId,
      "/tags",
      pickName,
    );
    if (companyMatches.length > 0) {
      return {
        ...resolveExactTag(companyMatches, requestedName),
        scope: "company",
      };
    }
  } catch (error) {
    companyError = error instanceof Error ? error.message : "company /tags failed";
  }

  // Private tags: try tea_ id, then email alias if /teammates/{id} yields one.
  // Connect Proxy often 403s teammate-scoped /tags even when company /tags works.
  const teammatePaths = [
    `/teammates/${encodeURIComponent(teammateId)}/tags`,
  ];
  try {
    const teammate = asRecord(
      await frontProxyGet(
        userId,
        accountId,
        `/teammates/${encodeURIComponent(teammateId)}`,
      ),
    );
    const email = textField(teammate.email);
    if (email.includes("@")) {
      teammatePaths.push(`/teammates/${encodeURIComponent(email)}/tags`);
    }
  } catch {
    // Identity lookup is best-effort; tea_ path may still work.
  }

  let teammateError: string | null = null;
  for (const path of teammatePaths) {
    try {
      const teammateMatchesForTag = await paginateCollection(
        userId,
        accountId,
        path,
        pickName,
      );
      if (teammateMatchesForTag.length > 0) {
        return {
          ...resolveExactTag(teammateMatchesForTag, requestedName),
          scope: "teammate",
        };
      }
    } catch (error) {
      teammateError =
        error instanceof Error ? error.message : "teammate tags failed";
    }
  }

  const parts = [
    `Front tag "${requestedName}" was not found`,
    companyError ? `company /tags: ${companyError}` : "company /tags: no match",
    teammateError
      ? `teammate ${teammateId}/tags: ${teammateError}`
      : `teammate ${teammateId}/tags: no match`,
    "Pass tag_id (tag_…) or set Config → Front — Chief Inbox Zero tag id. A Connect Proxy 403 on teammate /tags is a known gap, not broken Pipedream project credentials.",
  ];
  throw new Error(parts.join(". "));
}

async function resolveTagForSearch(
  userId: string,
  accountId: string,
  input: { tagId?: string; tagName?: string; teammateId: string },
): Promise<{ id: string; name: string; scope: "company" | "teammate" | "explicit" }> {
  const explicit = textField(input.tagId);
  if (explicit) {
    const id = normalizeFrontTagId(explicit);
    return {
      id,
      name: textField(input.tagName) || DEFAULT_FRONT_INBOX_ZERO_TAG,
      scope: "explicit",
    };
  }

  const { getAppSettings } = await import("@/lib/settings");
  const settings = await getAppSettings().catch(() => null);
  const fromSettings = textField(settings?.["front.inbox_zero_tag_id"]);
  const requestedName =
    textField(input.tagName) || DEFAULT_FRONT_INBOX_ZERO_TAG;
  // Only use the saved Inbox Zero tag id when searching that tag (or default).
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

  return resolveTagByName(
    userId,
    accountId,
    requestedName,
    input.teammateId,
  );
}

async function resolveTeammate(
  userId: string,
  accountId: string,
  requested: string,
): Promise<{ id: string; name: string }> {
  const normalized = normalizeFrontTeammateId(requested);
  // Trust an explicit tea_ id for private-tag scoping. Looking up /teammates/{id}
  // can fail under the same Connect Proxy limits as /me.
  if (/^tea_[a-zA-Z0-9]+$/.test(normalized)) {
    try {
      const direct = asRecord(
        await frontProxyGet(
          userId,
          accountId,
          `/teammates/${encodeURIComponent(normalized)}`,
        ),
      );
      const id = normalizeFrontTeammateId(textField(direct.id) || normalized);
      const name = teammateLabel(direct) || textField(direct.email) || id;
      if (id) return { id, name };
    } catch {
      return { id: normalized, name: normalized };
    }
    return { id: normalized, name: normalized };
  }

  const matches = await paginateCollection(userId, accountId, "/teammates", (t) =>
    teammateMatches(t, requested),
  );
  if (matches.length === 0) {
    throw new Error(`Front teammate "${requested}" was not found.`);
  }
  if (matches.length > 1) {
    const exact = matches.filter((t) => {
      const email = textField(asRecord(t).email).toLowerCase();
      return email && email === requested.trim().toLowerCase();
    });
    const chosen = exact.length === 1 ? exact : matches;
    if (chosen.length > 1) {
      throw new Error(
        `More than one Front teammate matches "${requested}". Use their email or tea_ id.`,
      );
    }
    const item = asRecord(chosen[0]);
    return {
      id: normalizeFrontTeammateId(textField(item.id)),
      name: teammateLabel(item) || textField(item.email),
    };
  }
  const item = asRecord(matches[0]);
  const id = normalizeFrontTeammateId(textField(item.id));
  const name = teammateLabel(item) || textField(item.email);
  if (!id || !name) throw new Error(`Front teammate "${requested}" was incomplete.`);
  return { id, name };
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
  source: "search" | "tag_conversations" | "mcp_list_filter";
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

/** One compact page of open Front conversations matching optional filters. */
export async function searchFrontConversations(
  input: FrontSearchInput = {},
): Promise<FrontSearchResult> {
  try {
    return await searchFrontConversationsViaProxy(input);
  } catch (proxyError) {
    if (input.allowSearchFallback === false) throw proxyError;
    // MCP list is all_inboxes + open — misses no-inbox discussions and
    // non-open statuses. Prefer failing the proxy error in those cases.
    const status = normalizeFrontSearchStatus(input.status);
    if (textField(input.assignee) || status !== "open") {
      throw proxyError;
    }
    const { searchFrontConversationsViaMcp } = await import(
      "@/lib/front-search-mcp"
    );
    const fallback = await searchFrontConversationsViaMcp({
      tagName: input.tagName,
      teammate: input.teammate,
      proxyError:
        proxyError instanceof Error
          ? proxyError.message
          : "Connect Proxy failed",
    });
    const explicitTagId = textField(input.tagId);
    return {
      query: fallback.query,
      source: fallback.source,
      filters: {
        ...(fallback.filters.tag
          ? {
              tag: {
                id: explicitTagId || "",
                name: fallback.filters.tag.name,
                ...(explicitTagId ? { scope: "explicit" as const } : {}),
              },
            }
          : {}),
        ...(fallback.filters.teammate
          ? { teammate: fallback.filters.teammate }
          : {}),
      },
      account: fallback.account,
      count: fallback.count,
      conversations: fallback.conversations,
      nextCursor: null,
      hasMore: false,
      proxyError: fallback.proxyError,
      note: fallback.note,
      sampleTags: fallback.sampleTags,
    };
  }
}

async function searchFrontConversationsViaProxy(
  input: FrontSearchInput = {},
): Promise<FrontSearchResult> {
  const userId = await requireUserId();
  const connection = await findPipedreamConnectionByApp(
    userId,
    FRONTAPP_PIPEDREAM_SLUG,
  );
  if (!connection) {
    throw new Error(
      "Connect Front through Pipedream in Settings → Connections first.",
    );
  }

  const limitRaw =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.trunc(input.limit)
      : 25;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const cursor = textField(input.cursor) || undefined;

  const tagName = textField(input.tagName);
  const tagId = textField(input.tagId);
  const status = normalizeFrontSearchStatus(input.status);
  const assignee = textField(input.assignee);
  const participant = textField(input.participant);
  const teammateHint = textField(input.teammate);

  const owner = await resolveOwnerTeammate(
    userId,
    connection.accountId,
    teammateHint,
  );

  const filters: FrontSearchResult["filters"] = {
    teammate: owner,
    status,
  };

  const wantsTag = Boolean(tagId) || Boolean(tagName);
  if (wantsTag) {
    let tag: {
      id: string;
      name: string;
      scope: "company" | "teammate" | "explicit";
    };
    try {
      tag = await resolveTagForSearch(userId, connection.accountId, {
        tagId,
        tagName,
        teammateId: owner.id,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "tag resolve failed";
      throw new Error(
        `Front proxy failed while resolving tag "${tagName || tagId || DEFAULT_FRONT_INBOX_ZERO_TAG}" (pass tag_id / Config front.inbox_zero_tag_id, or company /tags + teammate ${owner.id}/tags): ${detail}`,
      );
    }
    filters.tag = tag;

    // Prefer GET /tags/{id}/conversations — includes discussions with no inbox.
    // Bare path returned the full ~23 set via absolute api2 while relative
    // Connect Proxy often 403s the same path. Prefer absolute; try encodings
    // sequentially; do not fail-fast on the first 403.
    const tagListQuery =
      status === "open"
        ? `tag:${tag.id} statuses:assigned,unassigned`
        : status === "all"
          ? `tag:${tag.id}`
          : `tag:${tag.id} is:${status}`;
    try {
      const paths = buildTagConversationsPathOptions(
        tag.id,
        limit,
        cursor,
        status,
      );
      const byId = new Map<string, ReturnType<typeof compactConversation>>();
      const errors: string[] = [];
      let bestPath = "";
      let nextCursor: string | null = null;
      let reportedTotal: number | undefined;
      let bestPageCount = -1;

      for (const path of paths) {
        try {
          const response = await frontProxyGet(
            userId,
            connection.accountId,
            path,
            { preferAbsolute: true },
          );
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
          // Bare / richest path already has rows — skip slower alternate encodings.
          if (byId.size > 0 && path === paths[0]) break;
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : "proxy failed";
          errors.push(`${path}: ${detail}`.slice(0, 180));
        }
      }

      if (byId.size === 0) {
        throw formatTagConversationsEmptyError(tag.id, paths.length, errors);
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
          const response = await frontProxyGet(
            userId,
            connection.accountId,
            paginatedPath,
            { preferAbsolute: true },
          );
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

      const conversations = [...byId.values()];
      return {
        query: tagListQuery,
        source: "tag_conversations",
        filters,
        account: connection.accountName ?? connection.accountId,
        count: conversations.length,
        ...(reportedTotal !== undefined
          ? { total: Math.max(reportedTotal, conversations.length) }
          : { total: conversations.length }),
        conversations,
        nextCursor,
        hasMore: Boolean(nextCursor),
        note: `Used GET /tags/{id}/conversations (${conversations.length} unique; best page had ${bestPageCount}; ${errors.length} encoding(s) failed).`,
      };
    } catch (tagListError) {
      // Inbox must not silently under-count via Search. Tools may still fall back.
      if (input.allowSearchFallback === false) {
        throw tagListError;
      }
      const query = buildFrontSearchQuery({ tagId: tag.id, status });
      const qs = new URLSearchParams({ limit: String(limit) });
      if (cursor) qs.set("page_token", cursor);
      try {
        const response = await frontProxyGet(
          userId,
          connection.accountId,
          `/conversations/search/${encodeURIComponent(query)}?${qs}`,
          { absoluteFallback: false },
        );
        const envelope = asRecord(response);
        const nextCursor = pageTokenFromNext(
          asRecord(envelope._pagination).next,
        );
        const conversations = resultsFrom(response).map(compactConversation);
        const total =
          typeof envelope._total === "number" ? envelope._total : undefined;
        return {
          query,
          source: "search",
          filters,
          account: connection.accountName ?? connection.accountId,
          count: conversations.length,
          ...(total !== undefined ? { total } : {}),
          conversations,
          nextCursor,
          hasMore: Boolean(nextCursor),
          note: `GET /tags/{id}/conversations failed (${tagListError instanceof Error ? tagListError.message : "error"}); fell back to inbox-scoped Search API (discussions without an inbox may be missing).`,
        };
      } catch (searchError) {
        throw new Error(
          `Front tag conversations failed (${tagListError instanceof Error ? tagListError.message : "error"}); Search API also failed (${searchError instanceof Error ? searchError.message : "error"}).`,
        );
      }
    }
  }

  if (assignee) {
    filters.assignee = await resolveTeammate(
      userId,
      connection.accountId,
      assignee,
    );
  }
  if (participant) {
    filters.participant = await resolveTeammate(
      userId,
      connection.accountId,
      participant,
    );
  }

  const query = buildFrontSearchQuery({
    tagId: filters.tag?.id,
    assigneeId: filters.assignee?.id,
    participantId: filters.participant?.id,
    status,
  });
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set("page_token", cursor);
  try {
    const response = await frontProxyGet(
      userId,
      connection.accountId,
      `/conversations/search/${encodeURIComponent(query)}?${qs}`,
    );

    const envelope = asRecord(response);
    const nextCursor = pageTokenFromNext(asRecord(envelope._pagination).next);
    const conversations = resultsFrom(response).map(compactConversation);
    const total =
      typeof envelope._total === "number" ? envelope._total : undefined;

    return {
      query,
      source: "search",
      filters,
      account: connection.accountName ?? connection.accountId,
      count: conversations.length,
      ...(total !== undefined ? { total } : {}),
      conversations,
      nextCursor,
      hasMore: Boolean(nextCursor),
      note: "Used Front Core Search API (inbox-scoped). For tag inventory including no-inbox discussions, pass tag_id/tag_name.",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "search failed";
    throw new Error(
      `Front Search API failed for query "${query}" (GET /conversations/search/…): ${detail}`,
    );
  }
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

/** GET /conversations/{id} via Connect Proxy — detail for the Front-tag inbox. */
export async function getFrontConversationById(
  conversationId: string,
): Promise<CompactFrontConversation> {
  const id = textField(conversationId);
  if (!/^cnv_[a-zA-Z0-9]+$/.test(id)) {
    throw new Error(`Front conversation id must look like cnv_… (got "${id}").`);
  }
  const userId = await requireUserId();
  const connection = await findPipedreamConnectionByApp(
    userId,
    FRONTAPP_PIPEDREAM_SLUG,
  );
  if (!connection) {
    throw new Error(
      "Connect Front through Pipedream in Settings → Connections first.",
    );
  }
  const raw = await frontProxyGet(
    userId,
    connection.accountId,
    `/conversations/${encodeURIComponent(id)}`,
  );
  return compactConversation(raw);
}
