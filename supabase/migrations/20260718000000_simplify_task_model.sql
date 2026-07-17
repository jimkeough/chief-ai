-- =========================================================
-- Simplify the task model to a lightweight personal to-do
--
-- Chief is a single-user personal harness, not a project-management platform.
-- Tasks now hold only what needs doing: title, optional project, a 3-value
-- status, optional due date, a free-text "waiting on", notes, and manual sort
-- order. Projects hold the broader understanding and current state.
--
-- This migration is NON-DESTRUCTIVE: it remaps status values in place and adds
-- a column. No task rows are deleted and no columns are dropped. The extra
-- metadata columns (priority, impact, effort, category, delegate_to, source,
-- external_id, waiting_on_contact_id) are DEPRECATED — kept with their values
-- for backward compatibility, but no longer written or surfaced by the app.
-- =========================================================

-- 1. Collapse the five-value status set to three: open / waiting / done.
--    not_started, in_progress → open ; blocked → waiting ; waiting, done stay.
--    Remap the data BEFORE swapping the constraint so no row violates it.
update public.tasks set status = 'open'
  where status in ('not_started', 'in_progress');
update public.tasks set status = 'waiting'
  where status = 'blocked';

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('open', 'waiting', 'done'));
alter table public.tasks alter column status set default 'open';

-- 2. New user-facing field: free-text "waiting on" (person, company, event, or
--    dependency). Replaces the old contact-link approach for the simple model.
alter table public.tasks add column if not exists waiting_on text;

-- 3. Deprecate the extra metadata. Columns and values are retained for backward
--    compatibility; the app no longer displays, writes, or ranks by them.
comment on column public.tasks.priority is
  'DEPRECATED: manual sort order is the only priority. Retained for backward compatibility.';
comment on column public.tasks.impact is
  'DEPRECATED: no longer displayed or used. Retained for backward compatibility.';
comment on column public.tasks.effort is
  'DEPRECATED: no longer displayed or used. Retained for backward compatibility.';
comment on column public.tasks.category is
  'DEPRECATED: no longer displayed or used. Retained for backward compatibility.';
comment on column public.tasks.delegate_to is
  'DEPRECATED: delegation is now status=waiting + waiting_on + notes. Retained for backward compatibility.';
comment on column public.tasks.waiting_on_contact_id is
  'DEPRECATED: waiting-on is now free text (waiting_on). Retained for backward compatibility.';
comment on column public.tasks.source is
  'Internal integration metadata (not user-facing). Kept for import de-duplication.';
comment on column public.tasks.external_id is
  'Internal integration metadata (not user-facing). Kept for import de-duplication.';
