"use client";

// CURRENT STATE — the living record's headline block, editable in place
// (pencil → textarea → save), with the copper stale strip when the record
// hasn't been verified recently. Chief can use the surrounding project
// snapshot to propose a refreshed state without writing until approval.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { daysSince } from "@/lib/format";
import { useChief } from "./ChiefProvider";

export default function StateCard({
  projectId,
  currentState,
  lastVerifiedAt,
  agingDays,
}: {
  projectId: string;
  currentState: string | null;
  lastVerifiedAt: string | null;
  agingDays: number;
}) {
  const router = useRouter();
  const { runIntent } = useChief();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentState ?? "");
  const [busy, setBusy] = useState(false);

  const verifiedDays = daysSince(lastVerifiedAt);
  const stale = verifiedDays !== null && verifiedDays >= agingDays;

  async function save() {
    setBusy(true);
    await fetch(`/api/projects/${projectId}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current_state: draft.trim() || null }),
    });
    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-hairline bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
          CURRENT STATE
        </div>
        {!editing && (
          <button
            type="button"
            aria-label="Edit current state"
            onClick={() => {
              setDraft(currentState ?? "");
              setEditing(true);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
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
            rows={5}
            className="w-full rounded-control border border-hairline bg-raised p-3 text-[15px] leading-normal text-ink"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="h-10 flex-1 rounded-control font-mono text-[11px] tracking-[0.1em] disabled:opacity-50"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              {busy ? "SAVING…" : "SAVE"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-10 rounded-control border border-hairline px-4 font-mono text-[11px] tracking-[0.1em] text-ink-2"
            >
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        <div className="text-[15px] leading-normal text-ink">
          {currentState || (
            <span className="chief-voice text-ink-2">
              No state recorded yet — write where this stands, or let Chief keep
              it once Phase 3 lands.
            </span>
          )}
        </div>
      )}

      {!editing && stale && (
        <div
          className="flex items-center gap-2 rounded-control px-3 py-2.5"
          style={{
            background: "var(--copper-fill)",
            border: "1px solid var(--copper-border)",
          }}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "var(--copper)" }}
          />
          <span className="flex-1 whitespace-nowrap text-[13px] text-copper">
            Verified {verifiedDays} days ago
          </span>
          <button
            type="button"
            onClick={() =>
              void runIntent({ id: "project.refresh_state", projectId })
            }
            className="shrink-0 text-[13px] font-semibold text-ink"
          >
            Ask Chief to refresh →
          </button>
        </div>
      )}
    </div>
  );
}
