import { NextResponse } from "next/server";
import { getAuthed, unauthorized } from "@/lib/auth";
import {
  getChiefSession,
  updateChiefSession,
} from "@/lib/chief-sessions";
import type { ChiefHistoryMessage } from "@/lib/chief-session-types";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SNAPSHOT_CHARS = 2_000_000;
const PROPOSAL_STATUSES = new Set([
  "proposed",
  "executing",
  "done",
  "error",
  "dismissed",
  "superseded",
  "undoing",
  "undone",
]);

function validMessage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (
    (message.role !== "user" && message.role !== "assistant") ||
    typeof message.content !== "string"
  ) {
    return false;
  }
  if (message.attachments !== undefined) {
    if (
      !Array.isArray(message.attachments) ||
      message.attachments.some(
        (attachment) =>
          !attachment ||
          typeof attachment !== "object" ||
          typeof attachment.name !== "string" ||
          !["image", "document", "text"].includes(attachment.kind),
      )
    ) {
      return false;
    }
  }
  if (message.plan !== undefined) {
    const plan = message.plan as Record<string, unknown>;
    if (
      !plan ||
      typeof plan !== "object" ||
      typeof plan.version !== "number" ||
      !Array.isArray(plan.sourceNames) ||
      plan.sourceNames.some((name) => typeof name !== "string") ||
      (plan.sourceAttachmentIds !== undefined &&
        (!Array.isArray(plan.sourceAttachmentIds) ||
          plan.sourceAttachmentIds.some((id) => typeof id !== "string")))
    ) {
      return false;
    }
  }
  if (message.proposals !== undefined) {
    if (
      !Array.isArray(message.proposals) ||
      message.proposals.some((item) => {
        if (!item || typeof item !== "object") return true;
        const proposalItem = item as Record<string, unknown>;
        return (
          typeof proposalItem.uid !== "string" ||
          typeof proposalItem.status !== "string" ||
          !PROPOSAL_STATUSES.has(proposalItem.status) ||
          !proposalItem.proposal ||
          typeof proposalItem.proposal !== "object"
        );
      })
    ) {
      return false;
    }
  }
  return true;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid chat id." }, { status: 400 });
  }
  const session = await getChiefSession(id);
  if (!session) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }
  return NextResponse.json({ session });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Invalid chat id." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.messages) || !Array.isArray(body.history)) {
    return NextResponse.json(
      { error: "A chat snapshot needs messages and history." },
      { status: 400 },
    );
  }
  if (
    body.messages.length > 200 ||
    body.history.length > 200 ||
    !body.messages.every(validMessage) ||
    JSON.stringify({ messages: body.messages, history: body.history }).length >
      MAX_SNAPSHOT_CHARS
  ) {
    return NextResponse.json(
      { error: "This chat is too large to save." },
      { status: 413 },
    );
  }

  const history: ChiefHistoryMessage[] = [];
  for (const item of body.history) {
    if (
      !item ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string"
    ) {
      return NextResponse.json(
        { error: "Invalid chat history." },
        { status: 400 },
      );
    }
    history.push({ role: item.role, content: item.content.slice(0, 100_000) });
  }

  const updated = await updateChiefSession(id, {
    title: typeof body.title === "string" ? body.title : "New chat",
    messages: body.messages,
    history,
    pendingCount: Number.isFinite(body.pendingCount)
      ? Math.min(Math.max(Number(body.pendingCount), 0), 1000)
      : 0,
  });
  if (!updated) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }
  return NextResponse.json({ session: updated });
}
