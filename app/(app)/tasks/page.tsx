// Tasks — the full list. Open work first (status-ranked), recently completed
// below. Rows follow the design's task-row vocabulary; adding is direct. The
// open list is reorderable across every project: dragging sets one global
// manual order (persisted to each task's `sort`), applied within a status band.

import AddTask from "@/app/components/AddTask";
import ChiefPageSnapshot from "@/app/components/ChiefPageSnapshot";
import ProjectFilter from "@/app/components/ProjectFilter";
import TaskList from "@/app/components/TaskList";
import TasksChiefAction from "@/app/components/TasksChiefAction";
import { listProjects } from "@/lib/projects";
import { listTasks } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const [{ project }, tasks, projects] = await Promise.all([
    searchParams,
    listTasks(),
    listProjects(),
  ]);

  const projectNameById = Object.fromEntries(projects.map((p) => [p.id, p.name]));
  // Only honor a project filter that still exists.
  const selectedProject =
    project && projectNameById[project] ? project : null;

  // Offer only projects that actually have tasks (plus the current selection,
  // so a valid filter always shows up in the dropdown).
  const projectIdsWithTasks = new Set(
    tasks.map((t) => t.project_id).filter((id): id is string => !!id),
  );
  const filterProjects = projects.filter(
    (p) => projectIdsWithTasks.has(p.id) || p.id === selectedProject,
  );

  const visible = selectedProject
    ? tasks.filter((t) => t.project_id === selectedProject)
    : tasks;
  const open = visible.filter((t) => t.status !== "done");
  const done = visible.filter((t) => t.status === "done").slice(0, 10);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <ChiefPageSnapshot
        route="/tasks"
        label="Tasks"
        state={{
          open_tasks: tasks
            .filter((t) => t.status !== "done")
            .slice(0, 40)
            .map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              waiting_on: t.waiting_on,
              project_id: t.project_id,
              due_at: t.due_at,
            })),
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="text-micro text-ink-3">TASKS · {open.length}</div>
          {open.length > 1 && !selectedProject && (
            <div className="font-mono text-[10px] text-ink-3">
              HOLD ⋮⋮ TO REORDER
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ProjectFilter projects={filterProjects} selected={selectedProject} />
          {open.length > 0 && <TasksChiefAction />}
        </div>
      </div>

      <AddTask />

      <TaskList
        tasks={open}
        reorderable={!selectedProject}
        projectNameById={projectNameById}
        emptyLabel={
          selectedProject
            ? "No open tasks in this project."
            : "No open tasks. Enjoy it."
        }
      />

      {done.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="text-micro text-ink-3">DONE</div>
          <TaskList tasks={done} projectNameById={projectNameById} />
        </div>
      )}
    </div>
  );
}
