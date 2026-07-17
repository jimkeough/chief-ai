// Project detail — the living record: an editable header (name + one-liner),
// the editable CURRENT STATE card with the copper stale strip, an editable
// WAITING ON card, and the reorderable task list whose top row carries the
// "next" tag (the next action is simply the top task, no separate card).

import Link from "next/link";
import { notFound } from "next/navigation";
import AddTask from "@/app/components/AddTask";
import ChiefPageSnapshot from "@/app/components/ChiefPageSnapshot";
import ProjectChiefAction from "@/app/components/ProjectChiefAction";
import ProjectHeader from "@/app/components/ProjectHeader";
import StateCard from "@/app/components/StateCard";
import TaskList from "@/app/components/TaskList";
import WaitingOnCard from "@/app/components/WaitingOnCard";
import { getProject, getProjectState } from "@/lib/projects";
import { getNumericSetting } from "@/lib/settings";
import { listTasks, sortByManualOrder } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const [state, tasks, agingDays] = await Promise.all([
    getProjectState(id),
    listTasks({ projectId: id }),
    getNumericSetting("waiting.aging_days"),
  ]);

  // Pure `sort` order (not listTasks()'s status-banded order) — the next
  // action is simply the first row here, so this list IS that order.
  const openTasks = sortByManualOrder(tasks.filter((t) => t.status !== "done"));

  return (
    <div className="flex flex-col gap-4 pt-2">
      {/* What Chief sees when opened from this screen. */}
      <ChiefPageSnapshot
        route={`/projects/${project.id}`}
        label={`Project — ${project.name}`}
        state={{
          project: {
            id: project.id,
            name: project.name,
            summary: project.summary,
            owner: project.owner,
          },
          state,
          open_tasks: openTasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            waiting_on: t.waiting_on,
            due_at: t.due_at,
          })),
        }}
      />
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/projects"
          aria-label="Back to projects"
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
        <div className="text-micro text-ink-3">PROJECT</div>
        <ProjectChiefAction
          projectId={project.id}
          projectName={project.name}
        />
      </div>

      <ProjectHeader
        projectId={project.id}
        name={project.name}
        summary={project.summary}
      />

      <StateCard
        projectId={project.id}
        currentState={state?.current_state ?? null}
        lastVerifiedAt={state?.last_verified_at ?? null}
        agingDays={agingDays}
      />

      <WaitingOnCard
        projectId={project.id}
        waitingOn={state?.waiting_on ?? null}
      />

      {/* Tasks — the top row is the next action (tagged "next"). */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-micro text-ink-3">TASKS · {openTasks.length}</div>
          {openTasks.length > 1 && (
            <div className="font-mono text-[10px] text-ink-3">
              HOLD ⋮⋮ TO REORDER
            </div>
          )}
        </div>
        <TaskList
          tasks={openTasks}
          reorderable
          markFirst
          emptyLabel="No open tasks for this project."
        />
        <AddTask projectId={project.id} />
      </div>
    </div>
  );
}
