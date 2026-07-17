// Projects and the Chief's editable "current state" for each. Ported from
// Email-wrapper with the tenancy flipped: access goes through the session-bound
// client, so RLS scopes every query to the signed-in user — no explicit tenant
// key, no service role.
//
// A project carries identity (name, status, one-liner, owner). Its current-state
// record (open loops, blockers, decisions, what changed, plus a headline
// `current_state`) lives in a separate 1:1 table so the markdown state fields
// don't bloat project-list reads. The two are joined in memory by
// listProjectsWithState for context injection and the UI. The project's next
// action is NOT stored here — it's computed from the tasks (see
// lib/tasks.ts#firstOpenTask): the first open task in the project's manual
// sort order, always, with no separate AI-settable override.
//
// DEPRECATED columns: `project_state.next_action` and `next_task_id` still
// exist in the database (retained for backward compatibility) but are dead —
// deliberately absent from STATE_COLUMNS, the ProjectState type, and every
// read/write path. Nothing selects, displays, writes, or feeds them to Chief.
// Do not reintroduce them: selecting them here would leak stale values back
// into the project page's Chief snapshot. Next action is the computed first
// open task, full stop.

import { createClient } from "@/lib/supabase/server";

export type ProjectStatus = "active" | "paused" | "done" | "archived";
export type ProjectConfidence = "low" | "medium" | "high";

export type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  summary: string | null;
  owner: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
};

export type ProjectState = {
  id: string;
  project_id: string;
  current_state: string | null;
  open_loops: string | null;
  blockers: string | null;
  waiting_on: string | null;
  decisions: string | null;
  recent_changes: string | null;
  confidence: ProjectConfidence | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectWithState = Project & { state: ProjectState | null };

const PROJECT_COLUMNS =
  "id, name, status, summary, owner, sort, created_at, updated_at";
const STATE_COLUMNS =
  "id, project_id, current_state, open_loops, blockers, waiting_on, decisions, recent_changes, confidence, last_verified_at, created_at, updated_at";

// Active projects first, then by the user's sort, then name.
const STATUS_RANK: Record<ProjectStatus, number> = {
  active: 0,
  paused: 1,
  done: 2,
  archived: 3,
};

export async function listProjects(
  opts: { status?: ProjectStatus } = {},
): Promise<Project[]> {
  const supabase = await createClient();
  let query = supabase.from("projects").select(PROJECT_COLUMNS);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query.limit(200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Project[];
  // Sort in memory so the status ordering (active first) is explicit and stable.
  return rows.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      a.sort - b.sort ||
      a.name.localeCompare(b.name),
  );
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Project | null) ?? null;
}

// Case-insensitive lookup by name — used for create-or-find (so re-adding a
// project by name updates rather than duplicates).
export async function getProjectByName(name: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(PROJECT_COLUMNS)
    .ilike("name", name.trim())
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Project | null) ?? null;
}

export type CreateProjectInput = {
  name: string;
  status?: ProjectStatus;
  summary?: string | null;
  owner?: string | null;
  sort?: number;
};

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: input.name,
      status: input.status ?? "active",
      summary: input.summary ?? null,
      owner: input.owner ?? null,
      sort: input.sort ?? 0,
    })
    .select(PROJECT_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as Project;
}

export type ProjectPatch = {
  name?: string;
  status?: ProjectStatus;
  summary?: string | null;
  owner?: string | null;
  sort?: number;
};

export async function updateProject(
  id: string,
  patch: ProjectPatch,
): Promise<Project | null> {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.summary !== undefined) update.summary = patch.summary;
  if (patch.owner !== undefined) update.owner = patch.owner;
  if (patch.sort !== undefined) update.sort = patch.sort;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update(update)
    .eq("id", id)
    .select(PROJECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Project | null) ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getProjectState(
  projectId: string,
): Promise<ProjectState | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_state")
    .select(STATE_COLUMNS)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProjectState | null) ?? null;
}

export type ProjectStatePatch = {
  current_state?: string | null;
  open_loops?: string | null;
  blockers?: string | null;
  waiting_on?: string | null;
  decisions?: string | null;
  recent_changes?: string | null;
  confidence?: ProjectConfidence | null;
  // Stamped to now() on every write so callers don't have to supply it; pass a
  // value only to override.
  last_verified_at?: string | null;
};

// Insert-or-update the single state row for a project. Replace-per-field: only
// the fields present in the patch are written. last_verified_at is stamped on
// every write (it records when the state was last confirmed against evidence)
// and drives the copper "Verified N days ago" stale strip.
export async function upsertProjectState(
  projectId: string,
  patch: ProjectStatePatch,
  verifiedAt: string,
): Promise<ProjectState> {
  const supabase = await createClient();
  const fields: Record<string, unknown> = {};
  if (patch.current_state !== undefined) fields.current_state = patch.current_state;
  if (patch.open_loops !== undefined) fields.open_loops = patch.open_loops;
  if (patch.blockers !== undefined) fields.blockers = patch.blockers;
  if (patch.waiting_on !== undefined) fields.waiting_on = patch.waiting_on;
  if (patch.decisions !== undefined) fields.decisions = patch.decisions;
  if (patch.recent_changes !== undefined) fields.recent_changes = patch.recent_changes;
  if (patch.confidence !== undefined) fields.confidence = patch.confidence;
  fields.last_verified_at = patch.last_verified_at ?? verifiedAt;

  const existing = await getProjectState(projectId);
  if (existing) {
    const { data, error } = await supabase
      .from("project_state")
      .update(fields)
      .eq("project_id", projectId)
      .select(STATE_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return data as ProjectState;
  }
  const { data, error } = await supabase
    .from("project_state")
    .insert({ project_id: projectId, ...fields })
    .select(STATE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as ProjectState;
}

// Remove a project's current-state record entirely. Used by the undo path when
// an approved update_project_state CREATED the state row (undoing it means the
// row shouldn't exist at all, not that its fields go null).
export async function deleteProjectState(projectId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_state")
    .delete()
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
}

// One projects read + one state read, joined in memory. Used by the Chief
// context digest and the Projects page.
export async function listProjectsWithState(
  opts: { status?: ProjectStatus } = {},
): Promise<ProjectWithState[]> {
  const supabase = await createClient();
  const projects = await listProjects(opts);
  if (projects.length === 0) return [];
  const { data, error } = await supabase
    .from("project_state")
    .select(STATE_COLUMNS);
  if (error) throw new Error(error.message);
  const byProject = new Map(
    ((data as ProjectState[] | null) ?? []).map((s) => [s.project_id, s]),
  );
  return projects.map((p) => ({ ...p, state: byProject.get(p.id) ?? null }));
}
