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
  return pipedreamProxyRequest(userId, {
    accountId,
    method: "GET",
    url: `${FRONT_API_BASE}${path}`,
  });
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
      `Could not resolve Front teammate identity (${detail}). Set Config → Front — teammate id to your tea_… id (e.g. tea_36301790), or pass teammate in the tool call.`,
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
  source: "search" | "tag_conversations";
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
};

/** One compact page of open Front conversations matching optional filters. */
export async function searchFrontConversations(
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
    const tag = await resolveTagByName(
      userId,
      connection.accountId,
      tagName,
      owner.id,
    );
    filters.tag = tag;

    // Private/individual tags are most reliably inventoried through the tag's
    // conversations collection (what the Front tag view uses), not company search.
    const response = await frontProxyGet(
      userId,
      connection.accountId,
      buildTagOpenConversationsPath(tag.id, limit, cursor),
    );
    const envelope = asRecord(response);
    const nextCursor = pageTokenFromNext(asRecord(envelope._pagination).next);
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
    };
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
  } else if (!inboxName && !assignee) {
    // Default open inventory to the authorizing teammate's participation so
    // admin OAuth still surfaces personal/subscribed work (Jim folder, etc.).
    filters.participant = owner;
  }

  const query = buildOpenSearchQuery({
    tagId: filters.tag?.id,
    inboxId: filters.inbox?.id,
    assigneeId: filters.assignee?.id,
    participantId: filters.participant?.id,
  });
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set("page_token", cursor);
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
  };
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
