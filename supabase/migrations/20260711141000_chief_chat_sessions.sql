-- Resumable Chief conversations. The communications table remains the
-- append-only audit log; this table stores the richer UI state needed to
-- restore proposal cards, plans, and the model transcript.
create table if not exists public.chief_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  intent text not null default 'general',
  page_label text,
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  history jsonb not null default '[]'::jsonb
    check (jsonb_typeof(history) = 'array'),
  pending_count integer not null default 0 check (pending_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index if not exists chief_sessions_user_updated_idx
  on public.chief_sessions (user_id, updated_at desc);

create trigger chief_sessions_set_updated_at
  before update on public.chief_sessions
  for each row execute function public.set_updated_at();

alter table public.chief_sessions enable row level security;
create policy "chief_sessions_select_own" on public.chief_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "chief_sessions_insert_own" on public.chief_sessions
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "chief_sessions_update_own" on public.chief_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "chief_sessions_delete_own" on public.chief_sessions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Source files are private Storage objects so chat requests carry only durable
-- attachment ids instead of large base64 payloads.
create table if not exists public.chief_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  session_id uuid not null,
  name text not null,
  kind text not null check (kind in ('image', 'document', 'text')),
  media_type text not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id)
    references public.chief_sessions(id, user_id) on delete cascade
);

create index if not exists chief_attachments_session_idx
  on public.chief_attachments (user_id, session_id);

alter table public.chief_attachments enable row level security;
create policy "chief_attachments_select_own" on public.chief_attachments
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy "chief_attachments_insert_own" on public.chief_attachments
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "chief_attachments_delete_own" on public.chief_attachments
  for delete to authenticated
  using (user_id = (select auth.uid()));

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'chief-attachments',
  'chief-attachments',
  false,
  5242880,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'text/plain',
    'text/markdown',
    'text/csv'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "chief_storage_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chief-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "chief_storage_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chief-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "chief_storage_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chief-attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
