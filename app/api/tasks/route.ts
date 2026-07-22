import { NextResponse } from "next/server";
import { getAuthed, unauthorized } from "@/lib/auth";
import { createTask, listTasks } from "@/lib/tasks";

export async function GET(request: Request) {
  if (!(await getAuthed())) return unauthorized();
  const projectId = new URL(request.url).searchParams.get("projectId");
  const tasks = await listTasks(projectId ? { projectId } : {});
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  if (!(await getAuthed())) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  // Every task must belong to a project — the product's single opinion on where
  // work lives, enforced on both the manual and Chief-proposed create paths.
  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;
  if (!projectId) {
    return NextResponse.json(
      { error: "Every task must belong to a project." },
      { status: 400 },
    );
  }
  const task = await createTask({
    title,
    notes: body.notes ?? null,
    status: body.status,
    dueAt: body.dueAt ?? null,
    projectId,
    waitingOn: body.waitingOn ?? null,
  });
  return NextResponse.json({ task }, { status: 201 });
}
