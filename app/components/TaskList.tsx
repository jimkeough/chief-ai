"use client";

// The task list card: rows at 50px min-height with hairline dividers, checkbox
// toggle, title, and mono metadata (priority + due), per the design spec.
// Optionally reorderable (⋮⋮ handles) for the Project detail screen — drag is
// pointer-based so it works with a thumb.

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/tasks";
import { dueLabel, isOverdue } from "@/lib/format";
import { TaskCheckbox } from "./TaskBits";

async function patchTask(id: string, body: Record<string, unknown>) {
  await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function TaskRowMeta({ task }: { task: Task }) {
  const due = dueLabel(task.due_at);
  return (
    <div className="flex shrink-0 items-center gap-[7px] whitespace-nowrap font-mono text-[11px]">
      {task.status === "waiting" ? (
        <span className="text-ink-3">
          {task.waiting_on ? `waiting · ${task.waiting_on}` : "waiting"}
        </span>
      ) : due ? (
        <span className={isOverdue(task.due_at) ? "text-copper" : "text-ink-3"}>
          {due}
        </span>
      ) : null}
    </div>
  );
}

export default function TaskList({
  tasks,
  reorderable = false,
  markFirst = false,
  emptyLabel = "Nothing here.",
  projectNameById,
}: {
  tasks: Task[];
  reorderable?: boolean;
  // Tag the first open (non-done) row as the project's next action, replacing
  // the old standalone NEXT ACTION card.
  markFirst?: boolean;
  emptyLabel?: string;
  // When provided, each row shows a compact chip with its project's name
  // (looked up by project_id). Omitted on the project detail screen, where the
  // project is already the context.
  projectNameById?: Record<string, string>;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(() => tasks.map((t) => t.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep local order in sync when the server list changes identity.
  const serverIds = tasks.map((t) => t.id).join(",");
  const knownIds = useRef(serverIds);
  if (knownIds.current !== serverIds) {
    knownIds.current = serverIds;
    setOrder(tasks.map((t) => t.id));
    setDragId(null);
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered = order.map((id) => byId.get(id)).filter((t): t is Task => !!t);
  // The "next" tag lands on the first actionable (open) row — a waiting row is
  // never the next action while an open one exists.
  const firstOpenId = markFirst
    ? ordered.find((t) => t.status === "open")?.id ?? null
    : null;

  async function toggle(task: Task) {
    setBusy(task.id);
    await patchTask(task.id, {
      status: task.status === "done" ? "open" : "done",
    });
    setBusy(null);
    router.refresh();
  }

  // Pointer-based drag on the ⋮⋮ handle: track Y, swap within the local order,
  // persist the final order on release.
  function startDrag(taskId: string, startEvent: React.PointerEvent) {
    if (!reorderable) return;
    startEvent.preventDefault();
    setDragId(taskId);
    const ROW_H = 50;

    const move = (e: PointerEvent) => {
      const list = listRef.current;
      if (!list) return;
      const rect = list.getBoundingClientRect();
      const index = Math.min(
        Math.max(Math.floor((e.clientY - rect.top) / ROW_H), 0),
        order.length - 1,
      );
      setOrder((cur) => {
        const from = cur.indexOf(taskId);
        if (from === -1 || from === index) return cur;
        const next = cur.slice();
        next.splice(from, 1);
        next.splice(index, 0, taskId);
        return next;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragId(null);
      setOrder((finalOrder) => {
        fetch("/api/tasks/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: finalOrder }),
        }).then(() => router.refresh());
        return finalOrder;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (ordered.length === 0) {
    return (
      <div className="rounded-card border border-hairline bg-surface p-5">
        <p className="chief-voice text-base text-ink-2">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="flex flex-col overflow-hidden rounded-card border border-hairline bg-surface"
    >
      {ordered.map((task, i) => {
        const done = task.status === "done";
        const projectName = task.project_id
          ? projectNameById?.[task.project_id]
          : undefined;
        return (
          <div
            key={task.id}
            className={`box-border flex min-h-[50px] items-center gap-[11px] px-3.5 py-1.5 ${
              i < ordered.length - 1 ? "border-b border-hairline" : ""
            } ${dragId === task.id ? "bg-raised" : ""}`}
            style={reorderable ? { paddingLeft: 10 } : undefined}
          >
            {reorderable && (
              <div
                onPointerDown={(e) => startDrag(task.id, e)}
                className="shrink-0 cursor-grab touch-none select-none text-[13px] tracking-[1px] text-ink-3"
                style={{ opacity: 0.6 }}
                aria-label="Drag to reorder"
              >
                ⋮⋮
              </div>
            )}
            <TaskCheckbox
              done={done}
              disabled={busy === task.id}
              onToggle={() => toggle(task)}
            />
            <Link
              href={`/tasks/${task.id}`}
              className={`flex min-w-0 flex-1 items-center gap-2 text-[15px] font-medium ${
                done ? "text-ink-3 line-through" : task.status === "waiting" ? "text-ink-2" : "text-ink"
              }`}
            >
              {firstOpenId === task.id && (
                <span
                  className="shrink-0 rounded-chip px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em]"
                  style={{ background: "var(--teal-dim)", color: "var(--teal)" }}
                >
                  NEXT
                </span>
              )}
              {projectName && (
                <span
                  className="max-w-[40%] shrink-0 truncate rounded-chip bg-raised px-1.5 py-0.5 font-mono text-[9px] tracking-[0.04em] text-ink-3"
                  title={projectName}
                >
                  {projectName}
                </span>
              )}
              <span className="truncate">{task.title}</span>
            </Link>
            <TaskRowMeta task={task} />
            <svg
              width="6"
              height="10"
              viewBox="0 0 7 12"
              className="ml-0.5 shrink-0"
              aria-hidden="true"
            >
              <path
                d="M1 1l5 5-5 5"
                stroke="var(--ink-3)"
                strokeWidth="1.6"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
