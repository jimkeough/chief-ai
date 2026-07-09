import { NextResponse } from "next/server";
import { getAuthed, unauthorized } from "@/lib/auth";
import { createNote, listNotes } from "@/lib/notes";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getAuthed())) return unauthorized();
  const notes = await listNotes();
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  if (!(await getAuthed())) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  const text = String(body.body ?? "");
  if (!title && !text.trim()) {
    return NextResponse.json(
      { error: "A note needs a title or some text." },
      { status: 400 },
    );
  }
  const note = await createNote({ title, body: text, pinned: Boolean(body.pinned) });
  return NextResponse.json({ note }, { status: 201 });
}
