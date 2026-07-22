// Task detail — a single task on its own page. Shows and edits the record
// (title, status, waiting on, due, notes) and links back to its project. What
// Chief sees when opened here is the task itself.

import { notFound } from "next/navigation";
import ChiefPageSnapshot from "@/app/components/ChiefPageSnapshot";
import TaskDetail from "@/app/components/TaskDetail";
import { getProject, listProjects } from "@/lib/projects";
import { getTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) notFound();

  const [project, projects] = await Promise.all([
    task.project_id ? getProject(task.project_id) : Promise.resolve(null),
    listProjects(),
  ]);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <ChiefPageSnapshot
        route={`/tasks/${task.id}`}
        label={`Task — ${task.title}`}
        state={{
          task: {
            id: task.id,
            title: task.title,
            notes: task.notes,
            status: task.status,
            waiting_on: task.waiting_on,
            due_at: task.due_at,
            project_id: task.project_id,
            project_name: project?.name ?? null,
          },
        }}
      />
      <TaskDetail
        task={task}
        projectName={project?.name ?? null}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
