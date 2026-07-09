// Notes — general notes that aren't tasks or projects. Same tenancy model as
// tasks/projects: the session client + RLS, no explicit tenant key. Kept
// deliberately small — title, body, pinned — in the "plain, durable data"
// spirit. `updated_at` moves via the shared DB trigger on any edit.

import { createClient } from "@/lib/supabase/server";

export type Note = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

const COLUMNS = "id, title, body, pinned, created_at, updated_at";

export async function listNotes(): Promise<Note[]> {
  const supabase = await createClient();
  // Pinned first, then most-recently-touched (matches the notes_user_idx).
  const { data, error } = await supabase
    .from("notes")
    .select(COLUMNS)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as Note[];
}

export async function getNote(id: string): Promise<Note | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .select(COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Note | null) ?? null;
}

export type CreateNoteInput = {
  title?: string;
  body?: string;
  pinned?: boolean;
};

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .insert({
      title: input.title ?? "",
      body: input.body ?? "",
      pinned: input.pinned ?? false,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as Note;
}

export type NotePatch = {
  title?: string;
  body?: string;
  pinned?: boolean;
};

export async function updateNote(
  id: string,
  patch: NotePatch,
): Promise<Note | null> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.body !== undefined) update.body = patch.body;
  if (patch.pinned !== undefined) update.pinned = patch.pinned;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notes")
    .update(update)
    .eq("id", id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Note | null) ?? null;
}

export async function deleteNote(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
