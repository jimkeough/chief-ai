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
  buildOpenSearchQuery,
  buildTagOpenConversationsPath,
  buildTaggedOpenQuery,
  compactConversation,
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  FRONT_API_BASE,
  FRONTAPP_PIPEDREAM_SLUG,
  nameMatchesIgnoreCase,
  normalizeFrontTeammateId,
  pageTokenFromNext,
  resolveExactNamedResource,
  resolveExactTag,
  resultsFrom,
  teammateLabel,
  teammateMatches,
  textField,
  type CompactFrontConversation,
} from "@/lib/front-search-helpers";

export {
  buildOpenSearchQuery,
  buildTagOpenConversationsPath,
  buildTaggedOpenQuery,
  compactConversation,
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  FRONT_API_BASE,
  FRONTAPP_PIPEDREAM_SLUG,
  normalizeFrontTeammateId,
  pageTokenFromNext,
  resolveExactTag,
  resultsFrom,
  type CompactFrontConversation,
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

async function frontProxyGet(
  userId: string,
  accountId: string,
  pathWithQuery: string,
): Promise<unknown> {
  const path = pathWithQuery.startsWith("/")
    ? pathWithQuery
    : `/${pathWithQuery}`;
  // Prefer relative paths so Pipedream resolves Front's base_proxy_target_url.
  // Full api2 URLs fail when allowed_domains don't include api2.frontapp.com.
  try {
    return await pipedreamProxyRequest(userId, {
      accountId,
      method: "GET",
      url: path,
    });
  } catch (relativeError) {
    try {
      return await pipedreamProxyRequest(userId, {
        accountId,
        method: "GET",
        url: `${FRONT_API_BASE}${path}`,
      });
    } catch {
      throw relativeError;
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

  const companyMatches = await paginateCollection(
    userId,
    accountId,
    "/tags",
    pickName,
  );
  if (companyMatches.length > 0) {
    return { ...resolveExactTag(companyMatches, requestedName), scope: "company" };
  }

  const teammateMatchesForTag = await paginateCollection(
    userId,
    accountId,
    `/teammates/${encodeURIComponent(teammateId)}/tags`,
    pickName,
  );
  if (teammateMatchesForTag.length > 0) {
    return {
      ...resolveExactTag(teammateMatchesForTag, requestedName),
      scope: "teammate",
    };
  }

  throw new Error(
    `Front tag "${requestedName}" was not found on company tags or teammate ${teammateId}'s tags.`,
  );
}

async function resolveInboxByName(
  userId: string,
  accountId: string,
  requestedName: string,
): Promise<{ id: string; name: string }> {
  const matches = await paginateCollection(
    userId,
    accountId,
    "/inboxes",
    (inbox) => nameMatchesIgnoreCase(asRecord(inbox).name, requestedName),
  );
  return resolveExactNamedResource(matches, requestedName, "inbox");
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
  /** Exact inbox name. Optional. */
  inboxName?: string;
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
};

export type FrontSearchResult = {
  query: string;
  source: "search" | "tag_conversations" | "mcp_list_filter";
  filters: {
    tag?: { id: string; name: string; scope?: "company" | "teammate" };
    inbox?: { id: string; name: string };
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
    // Inbox-style MCP list works when Connect Proxy does not (same as Calendar).
    // Skip MCP fallback when the caller asked for inbox/assignee filters the
    // list tool cannot apply accurately.
    if (textField(input.inboxName) || textField(input.assignee)) {
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
    return {
      query: fallback.query,
      source: fallback.source,
      filters: {
        ...(fallback.filters.tag
          ? { tag: { id: "", name: fallback.filters.tag.name } }
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
  const inboxName = textField(input.inboxName);
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
  };

  if (tagName) {
    let tag: { id: string; name: string; scope: "company" | "teammate" };
    try {
      tag = await resolveTagByName(
        userId,
        connection.accountId,
        tagName,
        owner.id,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "tag resolve failed";
      throw new Error(
        `Front proxy failed while resolving tag "${tagName}" (company /tags and teammate ${owner.id}/tags): ${detail}`,
      );
    }
    filters.tag = tag;

    // Front Search API: GET /conversations/search/{query}
    // https://dev.frontapp.com/docs/search-1 — e.g. tag:tag_xxx is:open
    const query = buildOpenSearchQuery({ tagId: tag.id });
    const qs = new URLSearchParams({ limit: String(limit) });
    if (cursor) qs.set("page_token", cursor);
    const searchPath = `/conversations/search/${encodeURIComponent(query)}?${qs}`;

    try {
      const response = await frontProxyGet(
        userId,
        connection.accountId,
        searchPath,
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
        note: "Used Front Core Search API (GET /conversations/search/{query}) via Connect Proxy.",
      };
    } catch (searchError) {
      // Older path: list a tag's conversations. Prefer Search API; keep as backup.
      try {
        const response = await frontProxyGet(
          userId,
          connection.accountId,
          buildTagOpenConversationsPath(tag.id, limit, cursor),
        );
        const envelope = asRecord(response);
        const nextCursor = pageTokenFromNext(
          asRecord(envelope._pagination).next,
        );
        const conversations = resultsFrom(response).map(compactConversation);
        const total =
          typeof envelope._total === "number" ? envelope._total : undefined;
        return {
          query: `tag:${tag.id} statuses:assigned,unassigned`,
          source: "tag_conversations",
          filters,
          account: connection.accountName ?? connection.accountId,
          count: conversations.length,
          ...(total !== undefined ? { total } : {}),
          conversations,
          nextCursor,
          hasMore: Boolean(nextCursor),
          note: `Front Search API failed (${searchError instanceof Error ? searchError.message : "error"}); used /tags/{id}/conversations backup.`,
        };
      } catch (tagListError) {
        throw new Error(
          `Front Search API failed (${searchError instanceof Error ? searchError.message : "error"}); tag conversations backup also failed (${tagListError instanceof Error ? tagListError.message : "error"}).`,
        );
      }
    }
  }

  if (inboxName) {
    filters.inbox = await resolveInboxByName(
      userId,
      connection.accountId,
      inboxName,
    );
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
  // No default participant filter: open inventory should return company-visible
  // open conversations. Pass participant/assignee explicitly when scoping to Jim.

  const query = buildOpenSearchQuery({
    tagId: filters.tag?.id,
    inboxId: filters.inbox?.id,
    assigneeId: filters.assignee?.id,
    participantId: filters.participant?.id,
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
      note: "Used Front Core Search API (GET /conversations/search/{query}) via Connect Proxy.",
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
  teammate?: string;
  limit?: number;
  cursor?: string;
}): Promise<FrontSearchResult> {
  return searchFrontConversations({
    tagName: textField(input.tagName) || DEFAULT_FRONT_INBOX_ZERO_TAG,
    teammate: input.teammate,
    limit: input.limit,
    cursor: input.cursor,
  });
}
