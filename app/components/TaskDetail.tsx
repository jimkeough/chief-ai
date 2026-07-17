"use client";

// Task detail — the task on its own page. Title and notes edit in place; status
// and priority are one-tap pill selectors; the due date is a native date field.
// Everything writes through PATCH /api/tasks/[id]; delete removes the task and
// returns to the list. Kept deliberately direct — the ranking narrative and
// Chief proposals live elsewhere.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Task, TaskPriority, TaskStatus } from "@/lib/tasks";

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "not_started", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting", label: "Waiting" },
  { value: "blocked", label: "Blocked" },
  { value: "done", label: "Done" },
];

const PRIORITIES: TaskPriority[] = ["P0", "P1", "P2", "P3", "P4"];

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function TaskDetail({
  task,
  projectName,
}: {
  task: Task;
  projectName: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    router.refresh();
  }

  async function saveTitle() {
    const clean = titleDraft.trim();
    if (!clean) return;
    await patch({ title: clean });
    setEditingTitle(false);
  }

  async function saveNotes() {
    await patch({ notes: notesDraft.trim() || null });
    setNotesDirty(false);
  }

  async function remove() {
    if (!window.confirm("Delete this task?")) return;
    setBusy(true);
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (task.project_id) {
      router.push(`/projects/${task.project_id}`);
    } else {
      router.push("/tasks");
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href={task.project_id ? `/projects/${task.project_id}` : "/tasks"}
          aria-label="Back"
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-hairline"
        >
          <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true">
            <path
              d="M7 1L1 7l6 6"
              stroke="var(--ink-2)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <div className="text-micro text-ink-3">TASK</div>
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="ml-auto font-mono text-[11px] tracking-[0.1em] text-ink-3 disabled:opacity-50"
        >
          DELETE
        </button>
      </div>

      {/* Title */}
      {editingTitle ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            rows={2}
            className="w-full rounded-control border border-hairline bg-raised p-3 text-[20px] font-semibold leading-tight text-ink"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveTitle}
              disabled={busy || !titleDraft.trim()}
              className="h-10 flex-1 rounded-control font-mono text-[11px] tracking-[0.1em] disabled:opacity-50"
              style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
            >
              {busy ? "SAVING…" : "SAVE"}
            </button>
            <button
              type="button"
              onClick={() => {
                setTitleDraft(task.title);
                setEditingTitle(false);
              }}
              className="h-10 rounded-control border border-hairline px-4 font-mono text-[11px] tracking-[0.1em] text-ink-2"
            >
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <h1
            className={`min-w-0 flex-1 text-[20px] font-semibold leading-tight ${
              task.status === "done" ? "text-ink-3 line-through" : "text-ink"
            }`}
          >
            {task.title}
          </h1>
          <button
            type="button"
            aria-label="Edit title"
            onClick={() => {
              setTitleDraft(task.title);
              setEditingTitle(true);
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
      )}

      {task.project_id && projectName && (
        <Link
          href={`/projects/${task.project_id}`}
          className="flex items-center gap-1.5 text-[13px] text-teal"
        >
          <span className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
            PROJECT
          </span>
          {projectName}
        </Link>
      )}

      {/* Status */}
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
          STATUS
        </div>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => {
            const on = task.status === s.value;
            return (
              <button
                key={s.value}
                type="button"
                disabled={busy}
                onClick={() => void patch({ status: s.value })}
                className="h-9 rounded-chip px-3 font-mono text-[11px] tracking-[0.06em] disabled:opacity-50"
                style={
                  on
                    ? { background: "var(--teal-fill)", color: "var(--teal-on-fill)" }
                    : { border: "1px solid var(--hairline)", color: "var(--ink-2)" }
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Priority */}
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
          PRIORITY
        </div>
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.map((p) => {
            const on = task.priority === p;
            const hot = p === "P0" || p === "P1";
            return (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => void patch({ priority: on ? null : p })}
                className="h-9 w-11 rounded-chip font-mono text-[11px] disabled:opacity-50"
                style={
                  on
                    ? hot
                      ? { background: "var(--copper-fill)", border: "1px solid var(--copper-border)", color: "var(--copper)" }
                      : { background: "var(--teal-fill)", color: "var(--teal-on-fill)" }
                    : { border: "1px solid var(--hairline)", color: "var(--ink-2)" }
                }
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      {/* Due date */}
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
          DUE
        </div>
        <input
          type="date"
          value={toDateInput(task.due_at)}
          disabled={busy}
          onChange={(e) =>
            void patch({
              dueAt: e.target.value
                ? new Date(`${e.target.value}T00:00:00`).toISOString()
                : null,
            })
          }
          className="h-11 w-full rounded-control border border-hairline bg-surface px-3 text-[15px] text-ink disabled:opacity-50"
        />
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[10px] tracking-[0.1em] text-ink-3">
          NOTES
        </div>
        <textarea
          value={notesDraft}
          onChange={(e) => {
            setNotesDraft(e.target.value);
            setNotesDirty(true);
          }}
          rows={4}
          placeholder="Add notes…"
          className="w-full rounded-control border border-hairline bg-surface p-3 text-[15px] leading-normal text-ink placeholder:text-ink-3"
        />
        {notesDirty && (
          <button
            type="button"
            onClick={saveNotes}
            disabled={busy}
            className="h-10 self-start rounded-control px-4 font-mono text-[11px] tracking-[0.1em] disabled:opacity-50"
            style={{ background: "var(--teal-fill)", color: "var(--teal-on-fill)" }}
          >
            {busy ? "SAVING…" : "SAVE NOTES"}
          </button>
        )}
      </div>
    </div>
  );
}
