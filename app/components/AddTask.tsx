"use client";

// Quiet add-task composer: a single control-height input that posts on enter.
// Stays out of the way — the design's thumb-zone primary actions belong to
// Chief; this is just direct manipulation for the list owner.
//
// Every task belongs to a project. On a project detail screen the project is
// fixed (`projectId`), so there's no picker. On the global Tasks list the owner
// must choose the project from `projects` before adding — an unfiled task is
// not allowed.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddTask({
  projectId,
  projects,
  defaultProjectId,
}: {
  /** Fixed project (project detail screen) — when set, no picker is shown. */
  projectId?: string;
  /** Choosable projects (global Tasks list). Required when `projectId` is unset. */
  projects?: { id: string; name: string }[];
  /** Pre-selected project in the picker (e.g. the active project filter). */
  defaultProjectId?: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const needsPicker = !projectId;
  const [chosenProjectId, setChosenProjectId] = useState(
    defaultProjectId ?? "",
  );
  const noProjects = needsPicker && (projects?.length ?? 0) === 0;

  const targetProjectId = projectId ?? chosenProjectId;
  const canSubmit = Boolean(title.trim()) && Boolean(targetProjectId) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = title.trim();
    if (!clean || !targetProjectId || busy) return;
    setBusy(true);
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: clean, projectId: targetProjectId }),
    });
    setTitle("");
    setBusy(false);
    router.refresh();
  }

  if (noProjects) {
    return (
      <div className="rounded-control border border-hairline bg-surface px-3.5 py-3 text-body text-ink-3">
        Create a project first — every task belongs to one.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          className="h-12 min-w-0 flex-1 rounded-control border border-hairline bg-surface px-3.5 text-body text-ink placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="h-12 shrink-0 rounded-control px-4 font-mono text-[11px] tracking-[0.1em] disabled:opacity-50"
          style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
        >
          ADD
        </button>
      </div>
      {needsPicker && (
        <select
          value={chosenProjectId}
          onChange={(e) => setChosenProjectId(e.target.value)}
          aria-label="Project"
          className="h-11 rounded-control border border-hairline bg-surface px-3 text-body text-ink"
        >
          <option value="">Choose a project…</option>
          {projects!.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </form>
  );
}
