// GET /api/inbox/front — Front-tag inbox list.
//
// Requires Config front.inbox_zero_tag_id. Uses GET /tags/{id}/conversations
// (via searchFrontConversations) so no-inbox discussions are included.

import { getAuthed, unauthorized } from "@/lib/auth";
import {
  DEFAULT_FRONT_INBOX_ZERO_TAG,
  normalizeFrontTagId,
  searchFrontConversations,
  textField,
} from "@/lib/front-search";
import type { FrontTagInboxResponse, InboxThreadSummary } from "@/lib/inbox-source";
import { findPipedreamConnectionByApp } from "@/lib/pipedream";
import { FRONTAPP_PIPEDREAM_SLUG } from "@/lib/front-search-helpers";
import { getAppSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!(await getAuthed())) return unauthorized();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const connection = await findPipedreamConnectionByApp(
    user.id,
    FRONTAPP_PIPEDREAM_SLUG,
  ).catch(() => null);
  if (!connection) {
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
        'Set Config → Front — Chief Inbox Zero tag id (tag_…) to use Front as your inbox. That tag is the only stable Front inbox filter.',
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
  const cursor = textField(url.searchParams.get("cursor")) || undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(100, Math.max(1, Math.trunc(limitRaw)))
    : 100;

  try {
    const result = await searchFrontConversations({
      tagId,
      tagName: DEFAULT_FRONT_INBOX_ZERO_TAG,
      status,
      limit,
      cursor,
    });
    const threads: InboxThreadSummary[] = result.conversations.map((c) => ({
      id: c.id,
      provider: "front-tag" as const,
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
    }));

    const body: FrontTagInboxResponse = {
      provider: "front-tag",
      connected: true,
      tagId,
      tagName: result.filters.tag?.name || DEFAULT_FRONT_INBOX_ZERO_TAG,
      account: result.account,
      source: result.source,
      ...(result.total !== undefined ? { total: result.total } : {}),
      threads,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      note: result.note,
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
