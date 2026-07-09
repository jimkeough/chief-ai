import { NextResponse } from "next/server";
import { getAuthed, unauthorized } from "@/lib/auth";
import { deleteNote, updateNote } from "@/lib/notes";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const patch: { title?: string; body?: string; pinned?: boolean } = {};
  if (body.title !== undefined) patch.title = String(body.title);
  if (body.body !== undefined) patch.body = String(body.body);
  if (body.pinned !== undefined) patch.pinned = Boolean(body.pinned);
  const note = await updateNote(id, patch);
  if (!note) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ note });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await params;
  await deleteNote(id);
  return NextResponse.json({ ok: true });
}
