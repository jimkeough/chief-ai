// Front tagged-conversation search via Pipedream Connect API Proxy.
//
// Pipedream MCP exposes prebuilt Front actions; list-conversations cannot
// filter by tag. When a managed action is missing, Chief calls Front's Core
// API through Connect Proxy with the owner's existing Front OAuth grant — no
// Front token in Chief, no private Pipedream action publish step.

import { createClient } from "@/lib/supabase/server";
import {
  findPipedreamConnectionByApp,
  pipedreamProxyRequest,
} from "@/lib/pipedream";
import {
  asRecord,
  buildTaggedOpenQuery,
  compactConversation,
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  FRONT_API_BASE,
  FRONTAPP_PIPEDREAM_SLUG,
  pageTokenFromNext,
  resolveExactTag,
  resultsFrom,
  textField,
  type CompactFrontConversation,
} from "@/lib/front-search-helpers";

export {
  buildTaggedOpenQuery,
  compactConversation,
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  FRONT_API_BASE,
  FRONTAPP_PIPEDREAM_SLUG,
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

async function resolveTagByName(
  userId: string,
  accountId: string,
  requestedName: string,
): Promise<{ id: string; name: string }> {
  const matches: unknown[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (pageToken) qs.set("page_token", pageToken);
    const response = await frontProxyGet(userId, accountId, `/tags?${qs}`);
    for (const tag of resultsFrom(response)) {
      if (
        textField(asRecord(tag).name).toLowerCase() ===
        requestedName.toLowerCase()
      ) {
        matches.push(tag);
      }
    }
    const pagination = asRecord(asRecord(response)._pagination);
    pageToken = pageTokenFromNext(pagination.next);
    if (pageToken && seenPageTokens.has(pageToken)) {
      throw new Error("Front repeated a tag pagination cursor.");
    }
    if (pageToken) seenPageTokens.add(pageToken);
  } while (pageToken);

  return resolveExactTag(matches, requestedName);
}

export type FrontTaggedSearchInput = {
  tagName?: string;
  limit?: number;
  cursor?: string;
};

export type FrontTaggedSearchResult = {
  tag: { id: string; name: string };
  account: string;
  count: number;
  total?: number;
  conversations: CompactFrontConversation[];
  nextCursor: string | null;
  hasMore: boolean;
};

/** One compact page of open Front conversations carrying an exact tag. */
export async function searchTaggedOpenConversations(
  input: FrontTaggedSearchInput = {},
): Promise<FrontTaggedSearchResult> {
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

  const tagName = textField(input.tagName) || DEFAULT_FRONT_INBOX_ZERO_TAG;
  const limitRaw =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.trunc(input.limit)
      : 25;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const cursor = textField(input.cursor) || undefined;

  const tag = await resolveTagByName(userId, connection.accountId, tagName);
  const query = buildTaggedOpenQuery(tag.id);
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
    tag: { id: tag.id, name: tag.name },
    account: connection.accountName ?? connection.accountId,
    count: conversations.length,
    ...(total !== undefined ? { total } : {}),
    conversations,
    nextCursor,
    hasMore: Boolean(nextCursor),
  };
}
