-- Phase 4: Gmail connection. The user's Google OAuth tokens, held ONLY in
-- their own database (sovereign: their own OAuth client, their own Supabase).
-- One row per user; the refresh token is the durable credential, the access
-- token is a short-lived cache. Same tenancy convention as every table:
-- user_id → auth.users with RLS doing the real work.

create table if not exists public.google_tokens (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  -- The Gmail address this grant is for (from the userinfo/id_token), shown in
  -- Config so the user can see which account is connected.
  email text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger google_tokens_set_updated_at before update on public.google_tokens
  for each row execute function public.set_updated_at();

alter table public.google_tokens enable row level security;
create policy "google_tokens_own" on public.google_tokens for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
