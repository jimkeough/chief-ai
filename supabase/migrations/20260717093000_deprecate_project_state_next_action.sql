-- =========================================================
-- Deprecate (but keep) project_state.next_action / next_task_id
--
-- A project's next action is now always computed as the first open (non-done)
-- task in the project's manual sort order (see lib/tasks.ts#firstOpenTask).
-- The old free-text `next_action` and the `next_task_id` link are no longer
-- displayed, injected into Chief's context, maintained by the model, or exposed
-- in any write schema.
--
-- They are DEPRECATED but intentionally NOT dropped: existing values stay in
-- the database for backward compatibility. This migration re-adds them
-- `if not exists` so any environment that had already applied the earlier drop
-- gets the columns back, and records the deprecation via column comments.
-- =========================================================

alter table public.project_state
  add column if not exists next_action text,
  add column if not exists next_task_id uuid references public.tasks(id) on delete set null;

create index if not exists project_state_next_task_idx
  on public.project_state (next_task_id);

comment on column public.project_state.next_action is
  'DEPRECATED: no longer maintained or displayed. Next action is computed as the first open task (lib/tasks.ts#firstOpenTask). Retained for backward compatibility.';
comment on column public.project_state.next_task_id is
  'DEPRECATED: no longer maintained or displayed. Next action is computed as the first open task (lib/tasks.ts#firstOpenTask). Retained for backward compatibility.';
