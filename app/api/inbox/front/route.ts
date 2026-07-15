// GET /api/inbox/front — Front-tag inbox list.
//
// Requires Config front.inbox_zero_tag_id and the official Front MCP OAuth
// connection. Uses search_conversations with an exact tag-id filter.
// Paginates until exhausted (cap 200) so the Inbox shows the full tag set.

import { getAuthed, unauthorized } from "@/lib/auth";
import {
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  normalizeFrontTagId,
  searchFrontConversations,
  textField,
  type FrontSearchResult,
} from "@/lib/front-search";
import { getFrontOAuthStatus } from "@/lib/front-auth";
import type { FrontTagInboxResponse, InboxThreadSummary } from "@/lib/inbox-source";
import { getAppSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_THREADS = 200;
const PAGE_SIZE = 100;

function toThread(
  c: FrontSearchResult["conversations"][number],
): InboxThreadSummary {
  return {
    id: c.id,
    provider: "front-tag",
    subject: c.subject,
    status: c.status || c.statusCategory,
    preview: c.preview,
    correspondent: c.correspondent,
    updatedAt:
      typeof c.updatedAt === "string"
        ? c.updatedAt
        : typeof c.updatedAt === "number"
          ? new Date(c.updatedAt * 1000).toISOString()
          : null,
    tags: c.tags.map((t) => t.name).filter(Boolean),
    externalUrl: c.link,
  };
}

export async function GET(req: Request) {
  if (!(await getAuthed())) return unauthorized();

  const connection = await getFrontOAuthStatus().catch(() => null);
  if (!connection?.connected) {
    const body: FrontTagInboxResponse = {
      provider: "front-tag",
      connected: false,
    };
    return Response.json(body);
  }

  const settings = await getAppSettings().catch(() => null);
  const tagIdRaw = textField(settings?.["front.inbox_zero_tag_id"]);
  if (!tagIdRaw) {
    const body: FrontTagInboxResponse = {
      provider: "front-tag",
      connected: true,
      needsTag: true,
      message:
        "Set Config → Front — Chief Inbox Zero tag id (tag_…) to use Front as your inbox. That tag is the only stable Front inbox filter.",
    };
    return Response.json(body);
  }

  let tagId: string;
  try {
    tagId = normalizeFrontTagId(tagIdRaw);
  } catch (error) {
    const body: FrontTagInboxResponse = {
      provider: "front-tag",
      connected: true,
      error: error instanceof Error ? error.message : "Invalid tag id.",
    };
    return Response.json(body, { status: 400 });
  }

  const url = new URL(req.url);
  const status = textField(url.searchParams.get("status")) || "all";
  // Optional single-page mode for callers that want to drive pagination.
  const singlePage = url.searchParams.get("page") === "1";
  const cursor = textField(url.searchParams.get("cursor")) || undefined;

  try {
    const threads: InboxThreadSummary[] = [];
    let nextCursor: string | null = cursor ?? null;
    let hasMore = false;
    let source = "mcp_search";
    let account = "Front";
    let tagName = DEFAULT_FRONT_INBOX_ZERO_TAG;
    let note: string | undefined;
    let reportedTotal: number | undefined;
    let pages = 0;

    do {
      const result = await searchFrontConversations({
        tagId,
        tagName: DEFAULT_FRONT_INBOX_ZERO_TAG,
        status,
        limit: PAGE_SIZE,
        cursor: nextCursor ?? undefined,
        allowSearchFallback: false,
      });
      pages += 1;
      source = result.source;
      account = result.account;
      tagName = result.filters.tag?.name || DEFAULT_FRONT_INBOX_ZERO_TAG;
      note = result.note;
      if (typeof result.total === "number") reportedTotal = result.total;
      for (const c of result.conversations) {
        if (threads.length >= MAX_THREADS) break;
        threads.push(toThread(c));
      }
      nextCursor = result.nextCursor;
      hasMore = result.hasMore && threads.length < MAX_THREADS;
      if (singlePage) break;
    } while (hasMore && pages < 10);

    const body: FrontTagInboxResponse = {
      provider: "front-tag",
      connected: true,
      tagId,
      tagName,
      account,
      source,
      total: reportedTotal ?? threads.length,
      threads,
      nextCursor: singlePage ? nextCursor : hasMore ? nextCursor : null,
      hasMore: singlePage ? hasMore : threads.length >= MAX_THREADS && hasMore,
      note:
        note ??
        (pages > 1
          ? `Loaded ${threads.length} conversations across ${pages} pages.`
          : undefined),
    };
    return Response.json(body);
  } catch (error) {
    const body: FrontTagInboxResponse = {
      provider: "front-tag",
      connected: true,
      error: error instanceof Error ? error.message : "Front inbox failed.",
    };
    return Response.json(body, { status: 502 });
  }
}
