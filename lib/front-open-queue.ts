// Personal "open for me" queue for the Front Inbox.
//
// Front builds its own Open view by unioning several sub-lists (your inboxes,
// assigned, subscribed, discussions, …). There is no single API filter for
// that, so we mirror it: run each configured Front search query with the API
// token, page through it, then union + de-dupe by conversation id. Each query
// is objective (inbox/assignee/participant/tag), so a token can resolve it —
// unlike per-user markers (star/subscribe), which only your own login can read.

import { frontApiGet } from "@/lib/front-api";
import {
  asRecord,
  compactConversation,
  pageTokenFromNext,
  resultsFrom,
  type CompactFrontConversation,
} from "@/lib/front-search-helpers";

const MAX_PAGES_PER_QUERY = 20;
const MAX_TOTAL = 300;

export type FrontOpenQueueResult = {
  conversations: CompactFrontConversation[];
  total: number;
  /** Per-query diagnostics: how many NEW (deduped) rows each contributed. */
  perQuery: { query: string; count: number; error?: string }[];
};

/** Split the textarea setting into individual Front search queries. */
export function parseOpenQueries(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 25);
}

function searchPath(query: string, pageToken?: string): string {
  const base = `/conversations/search/${encodeURIComponent(query)}?limit=100`;
  return pageToken ? `${base}&page_token=${encodeURIComponent(pageToken)}` : base;
}

function sortKey(conversation: CompactFrontConversation): number {
  const value = conversation.updatedAt;
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

/** Union + de-dupe the results of every query, newest first. */
export async function searchFrontOpenQueue(
  queries: string[],
): Promise<FrontOpenQueueResult> {
  const byId = new Map<string, CompactFrontConversation>();
  const perQuery: FrontOpenQueueResult["perQuery"] = [];

  for (const query of queries) {
    let added = 0;
    try {
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const response = await frontApiGet(searchPath(query, pageToken));
        pages += 1;
        for (const item of resultsFrom(response)) {
          const conversation = compactConversation(item);
          if (conversation.id && !byId.has(conversation.id)) {
            byId.set(conversation.id, conversation);
            added += 1;
          }
        }
        pageToken = pageTokenFromNext(asRecord(asRecord(response)._pagination).next) ?? undefined;
      } while (pageToken && pages < MAX_PAGES_PER_QUERY && byId.size < MAX_TOTAL);
      perQuery.push({ query, count: added });
    } catch (error) {
      perQuery.push({
        query,
        count: added,
        error: error instanceof Error ? error.message.slice(0, 200) : "failed",
      });
    }
  }

  const conversations = [...byId.values()].sort((a, b) => sortKey(b) - sortKey(a));
  return { conversations, total: conversations.length, perQuery };
}
