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
  const task = await createTask({
    title,
    notes: body.notes ?? null,
    status: body.status,
    dueAt: body.dueAt ?? null,
    projectId: body.projectId ?? null,
    waitingOn: body.waitingOn ?? null,
  });
  return NextResponse.json({ task }, { status: 201 });
}
