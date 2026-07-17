"use client";

// Project header — the editable identity block. Name (h1) and the one-line
// summary edit in place (pencil → fields → save), writing through
// PATCH /api/projects/[id]. The status chip shows only for non-active
// projects; "active" is the silent default, so the badge stays out of the way.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectStatus } from "@/lib/projects";
import StatusChip from "./StatusChip";

export default function ProjectHeader({
  projectId,
  name,
  summary,
  status,
}: {
  projectId: string;
  name: string;
  summary: string | null;
  status: ProjectStatus;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [summaryDraft, setSummaryDraft] = useState(summary ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    const cleanName = nameDraft.trim();
    if (!cleanName) return;
    setBusy(true);
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: cleanName,
        summary: summaryDraft.trim() || null,
      }),
    });
    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          placeholder="Project name"
          className="w-full rounded-control border border-hairline bg-raised px-3 py-2 text-[22px] font-semibold leading-tight text-ink"
        />
        <textarea
          value={summaryDraft}
          onChange={(e) => setSummaryDraft(e.target.value)}
          placeholder="One-line description"
          rows={2}
          className="w-full rounded-control border border-hairline bg-raised p-3 text-[14px] leading-normal text-ink"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !nameDraft.trim()}
            className="h-10 flex-1 rounded-control font-mono text-[11px] tracking-[0.1em] disabled:opacity-50"
            style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
          >
            {busy ? "SAVING…" : "SAVE"}
          </button>
          <button
            type="button"
            onClick={() => {
              setNameDraft(name);
              setSummaryDraft(summary ?? "");
              setEditing(false);
            }}
            className="h-10 rounded-control border border-hairline px-4 font-mono text-[11px] tracking-[0.1em] text-ink-2"
          >
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <h1 className="min-w-0 flex-1 text-[22px] font-semibold leading-tight text-ink">
          {name}
        </h1>
        <button
          type="button"
          aria-label="Edit project name and description"
          onClick={() => {
            setNameDraft(name);
            setSummaryDraft(summary ?? "");
            setEditing(true);
          }}
          className="mt-1 shrink-0"
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
      </div>
      <div className="flex items-center gap-2">
        {status !== "active" && <StatusChip status={status} />}
        {summary && <span className="text-[14px] text-ink-2">{summary}</span>}
      </div>
    </div>
  );
}
