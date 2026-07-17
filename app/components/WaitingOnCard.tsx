"use client";

// WAITING ON — the one external dependency this project is stalled on, editable
// in place (pencil → textarea → save). Writes through the project's state
// record (PUT /api/projects/[id]/state), same replace-per-field upsert the
// CURRENT STATE card uses.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WaitingOnCard({
  projectId,
  waitingOn,
}: {
  projectId: string;
  waitingOn: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(waitingOn ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    await fetch(`/api/projects/${projectId}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waiting_on: draft.trim() || null }),
    });
    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-card border border-hairline bg-surface px-3.5 py-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
          WAITING ON
        </div>
        {!editing && (
          <button
            type="button"
            aria-label="Edit waiting on"
            onClick={() => {
              setDraft(waitingOn ?? "");
              setEditing(true);
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M9.5 1.5l3 3L5 12l-3.7.7L2 9l7.5-7.5z"
                stroke="var(--ink-3)"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Who or what this is waiting on…"
            className="w-full rounded-control border border-hairline bg-raised p-2.5 text-[14.5px] leading-snug text-ink"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-9 flex-1 rounded-control font-mono text-[11px] tracking-[0.1em] disabled:opacity-50"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              {busy ? "SAVING…" : "SAVE"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-9 rounded-control border border-hairline px-4 font-mono text-[11px] tracking-[0.1em] text-ink-2"
            >
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`text-[14.5px] leading-snug ${waitingOn ? "text-ink" : "text-ink-3"}`}
        >
          {waitingOn || "Nothing"}
        </div>
      )}
    </div>
  );
}
