import { NextResponse } from "next/server";
import { getAuthed, unauthorized } from "@/lib/auth";
import {
  createChiefSession,
  listChiefSessions,
} from "@/lib/chief-sessions";
import { isChiefIntentId } from "@/lib/chief-intents";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getAuthed())) return unauthorized();
  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const sessions = await listChiefSessions(
    Number.isFinite(requested) ? requested : 20,
  );
  return NextResponse.json({ sessions });
}

export async function POST(request: Request) {
  if (!(await getAuthed())) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const intent = isChiefIntentId(body.intent) ? body.intent : "general";
  const session = await createChiefSession({
    intent,
    title: typeof body.title === "string" ? body.title : undefined,
    pageLabel: typeof body.pageLabel === "string" ? body.pageLabel : null,
  });
  return NextResponse.json({ session }, { status: 201 });
}
