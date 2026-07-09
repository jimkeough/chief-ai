"use client";

// Notes UI — two states in one view: a quiet list of note cards, and a
// full-height editor you drop into by tapping a card (or "New note"). Minimal
// on purpose: title + body + pin, nothing else. Saving an empty note discards
// it, so tapping New and backing out never litters the list.

import { useCallback, useState } from "react";
import type { Note } from "@/lib/notes";

type Draft = { id: string | null; title: string; body: string; pinned: boolean };

const JSON_HEADERS = { "Content-Type": "application/json" };

function relDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export default function NotesClient({
  initial,
  ready,
}: {
  initial: Note[];
  ready: boolean;
}) {
  const [notes, setNotes] = useState<Note[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [migrated, setMigrated] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/notes")
      .then((res) => res.json())
      .catch(() => null);
    if (r?.notes) setNotes(r.notes as Note[]);
  }, []);

  // One-tap self-heal when the table isn't there yet (post-update, pre-migrate).
  const applyMigration = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMigrateError(null);
    try {
      const res = await fetch("/api/setup/migrate", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        await refresh();
        setMigrated(true);
      } else {
        setMigrateError(body.error ?? "Couldn't apply the update.");
      }
    } catch {
      setMigrateError("Couldn't apply the update.");
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  // Table missing and not yet fixed → offer the one-tap apply.
  if (!ready && !migrated) {
    return (
      <div className="flex flex-col gap-4 pt-2">
        <div className="text-micro text-ink-3">NOTES</div>
        <div
          className="flex flex-col gap-3 rounded-card border p-5"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <div className="text-[16px] font-semibold text-ink">
            One quick database update
          </div>
          <p className="text-[13.5px] leading-relaxed text-ink-2">
            Notes is new in this version and needs a table in your database. This
            runs the pending migration on your own Supabase — nothing leaves your
            instance.
          </p>
          <button
            onClick={() => void applyMigration()}
            disabled={busy}
            className="flex h-11 items-center justify-center rounded-control text-[15px] font-semibold disabled:opacity-50"
            style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
          >
            {busy ? "Applying…" : "Apply database update"}
          </button>
          {migrateError && (
            <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--danger)" }}>
              {migrateError}
            </p>
          )}
        </div>
      </div>
    );
  }

  const save = useCallback(async () => {
    if (!draft || busy) return;
    // Nothing typed → just leave; don't create an empty note.
    if (!draft.title.trim() && !draft.body.trim()) {
      setDraft(null);
      return;
    }
    setBusy(true);
    try {
      const payload = JSON.stringify({
        title: draft.title,
        body: draft.body,
        pinned: draft.pinned,
      });
      if (draft.id) {
        await fetch(`/api/notes/${draft.id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: payload,
        });
      } else {
        await fetch("/api/notes", {
          method: "POST",
          headers: JSON_HEADERS,
          body: payload,
        });
      }
      await refresh();
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, refresh]);

  const remove = useCallback(async () => {
    if (!draft?.id || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/notes/${draft.id}`, { method: "DELETE" });
      await refresh();
      setDraft(null);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, refresh]);

  // --- Editor -----------------------------------------------------------------
  if (draft) {
    return (
      <div className="flex h-[calc(100dvh-172px)] flex-col gap-3 pt-1">
        <div className="flex items-center justify-between">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="flex items-center gap-1 text-[14px] text-ink-2"
            aria-label="Back to notes"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M14.5 5.5L8 12l6.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Notes
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}
              aria-pressed={draft.pinned}
              aria-label={draft.pinned ? "Unpin" : "Pin"}
              className="flex h-9 w-9 items-center justify-center rounded-full"
              style={{ color: draft.pinned ? "var(--copper)" : "var(--ink-3)" }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill={draft.pinned ? "currentColor" : "none"} aria-hidden="true">
                <path d="M12 3.5l2.2 5.1 5.5.5-4.2 3.6 1.3 5.4L12 20.7l-4.1 2.4 1.3-5.4-4.2-3.6 5.5-.5L12 3.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </button>
            {draft.id && (
              <button
                onClick={() => void remove()}
                disabled={busy}
                aria-label="Delete note"
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 7h14M10 7V5.5h4V7m-7 0l.8 12.5h8.4L18 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            <button
              onClick={() => void save()}
              disabled={busy}
              className="ml-1 flex h-9 items-center rounded-control px-4 text-[14px] font-semibold"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              {busy ? "Saving…" : "Done"}
            </button>
          </div>
        </div>

        <input
          autoFocus={!draft.id}
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="Title"
          className="w-full bg-transparent text-[21px] font-semibold text-ink outline-none placeholder:text-ink-3"
        />
        <textarea
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          placeholder="Write…"
          className="min-h-0 flex-1 resize-none bg-transparent text-[16px] leading-relaxed text-ink-2 outline-none placeholder:text-ink-3"
        />
      </div>
    );
  }

  // --- List -------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex items-center justify-between">
        <div className="text-micro text-ink-3">NOTES · {notes.length}</div>
      </div>

      <button
        onClick={() => setDraft({ id: null, title: "", body: "", pinned: false })}
        className="flex h-11 items-center gap-2 rounded-card border px-4 text-[14.5px] text-ink-3"
        style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
      >
        <span className="text-[18px] leading-none text-ink-2">+</span>
        New note
      </button>

      {notes.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-1.5 rounded-card border px-6 py-16 text-center"
          style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
        >
          <div className="chief-voice text-[19px] text-ink">Nothing noted yet.</div>
          <div className="text-[13.5px] text-ink-3">
            Jot a thought, a list, anything. It stays in your own database.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {notes.map((n) => (
            <button
              key={n.id}
              onClick={() =>
                setDraft({ id: n.id, title: n.title, body: n.body, pinned: n.pinned })
              }
              className="flex flex-col gap-1.5 rounded-card border p-4 text-left"
              style={{ borderColor: "var(--hairline)", background: "var(--surface)" }}
            >
              <div className="flex items-start gap-2">
                {n.pinned && (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="var(--copper)"
                    className="mt-[3px] shrink-0"
                    aria-label="Pinned"
                  >
                    <path d="M12 3.5l2.2 5.1 5.5.5-4.2 3.6 1.3 5.4L12 20.7l-4.1 2.4 1.3-5.4-4.2-3.6 5.5-.5L12 3.5z" />
                  </svg>
                )}
                <div
                  className={`min-w-0 flex-1 truncate text-[15.5px] font-semibold ${n.title.trim() ? "text-ink" : "text-ink-3"}`}
                >
                  {n.title.trim() || "Untitled"}
                </div>
              </div>
              {n.body.trim() && (
                <div className="line-clamp-2 whitespace-pre-wrap text-[13.5px] leading-snug text-ink-2">
                  {n.body}
                </div>
              )}
              <div className="text-micro text-ink-3">{relDate(n.updated_at)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
