-- Background jobs for the sandbox coding agent (SANDBOX-PLAN.md).
--
-- A full Run (spin up VM → install Claude Code → edit → push → open PR) takes
-- minutes, which is too long to hold an HTTP request open. The route now starts
-- the work after responding and records progress here; the UI polls this table
-- for the result (the PR link) instead of waiting on one long request. Owned by
-- the user under RLS, like every other table.
create table if not exists public.sandbox_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  task text not null,
  status text not null default 'running'
    check (status in ('running', 'done', 'error')),
  pr_url text,
  pr_number integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sandbox_jobs_user_updated_idx
  on public.sandbox_jobs (user_id, updated_at desc);

-- Idempotent so re-running this file (e.g. if the migration ledger is out of
-- sync) never fails on an existing object.
create or replace trigger sandbox_jobs_set_updated_at
  before update on public.sandbox_jobs
  for each row execute function public.set_updated_at();

alter table public.sandbox_jobs enable row level security;
drop policy if exists "sandbox_jobs_select_own" on public.sandbox_jobs;
create policy "sandbox_jobs_select_own" on public.sandbox_jobs
  for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "sandbox_jobs_insert_own" on public.sandbox_jobs;
create policy "sandbox_jobs_insert_own" on public.sandbox_jobs
  for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "sandbox_jobs_update_own" on public.sandbox_jobs;
create policy "sandbox_jobs_update_own" on public.sandbox_jobs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "sandbox_jobs_delete_own" on public.sandbox_jobs;
create policy "sandbox_jobs_delete_own" on public.sandbox_jobs
  for delete to authenticated
  using (user_id = (select auth.uid()));
