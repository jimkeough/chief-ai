// GET /api/inbox/front/[id] — one Front conversation for the tag inbox detail.

import { getAuthed, unauthorized } from "@/lib/auth";
import { getFrontConversationById } from "@/lib/front-search";
import type { InboxThreadDetail } from "@/lib/inbox-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await ctx.params;
  try {
    const c = await getFrontConversationById(id);
    const detail: InboxThreadDetail = {
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
      body: c.body || c.preview,
      assignee: c.assignee,
      inboxes: c.inboxes.map((i) => i.name).filter(Boolean),
    };
    return Response.json({ ok: true, thread: detail });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not load conversation.",
      },
      { status: 502 },
    );
  }
}
