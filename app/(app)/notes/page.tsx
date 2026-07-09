// Notes — a plain place for general notes alongside Projects and Tasks. The
// list + editor are client-side (fast create/edit); the server just seeds the
// first paint and hands Chief a snapshot so it can see what's noted.

import ChiefPageSnapshot from "@/app/components/ChiefPageSnapshot";
import NotesClient from "./NotesClient";
import { listNotes, type Note } from "@/lib/notes";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  // Notes ships with a migration. On an existing instance that just pulled the
  // update, the `notes` table may not exist yet (updates deliver code, not
  // schema). Don't 500 — flag it and let the client offer a one-tap "apply
  // database update" (POST /api/setup/migrate).
  let notes: Note[] = [];
  let ready = true;
  try {
    notes = await listNotes();
  } catch {
    ready = false;
  }

  return (
    <>
      {ready && (
        <ChiefPageSnapshot
          route="/notes"
          label="Notes"
          state={{
            notes: notes.slice(0, 60).map((n) => ({
              id: n.id,
              title: n.title,
              preview: n.body.slice(0, 240),
              pinned: n.pinned,
              updated_at: n.updated_at,
            })),
          }}
        />
      )}
      <NotesClient initial={notes} ready={ready} />
    </>
  );
}
