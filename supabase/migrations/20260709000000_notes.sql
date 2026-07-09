-- Notes — a plain, durable place for general notes that aren't a task or a
-- project. Same tenancy as everything else (user_id → auth.users, RLS does the
-- work) and the shared updated_at trigger. Body is plain text/markdown, in the
-- "plain, durable data" spirit; structure emerges from use.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pinned first, then most-recently-touched.
create index if not exists notes_user_idx
  on public.notes (user_id, pinned desc, updated_at desc);

create trigger notes_set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

alter table public.notes enable row level security;
create policy "notes_own" on public.notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
