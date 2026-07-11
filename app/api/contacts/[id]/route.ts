import { NextResponse } from "next/server";
import { getAuthed, unauthorized } from "@/lib/auth";
import { deleteContact, updateContact } from "@/lib/contacts";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const patch: {
    name?: string;
    emails?: string[];
    company?: string | null;
    notes?: string | null;
  } = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    patch.name = name;
  }
  if (body.emails !== undefined) {
    if (!Array.isArray(body.emails)) {
      return NextResponse.json(
        { error: "Emails must be a list." },
        { status: 400 },
      );
    }
    patch.emails = body.emails.map(String);
  }
  if (body.company !== undefined) {
    patch.company = String(body.company).trim() || null;
  }
  if (body.notes !== undefined) {
    patch.notes = String(body.notes).trim() || null;
  }

  const contact = await updateContact(id, patch);
  if (!contact) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ contact });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await getAuthed())) return unauthorized();
  const { id } = await params;
  await deleteContact(id);
  return NextResponse.json({ ok: true });
}
