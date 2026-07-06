-- Mail 2.0: the app-password (IMAP/SMTP) connection — the low-friction
-- alternative to the Google OAuth path. One row per user; the app password is
-- a full-mailbox credential the user generates themselves (and can revoke at
-- any time from their provider), stored ONLY in their own database. Same
-- tenancy convention as everything: user_id → auth.users, RLS does the work.
--
-- Host defaults are Gmail's; other providers (Outlook, Fastmail, iCloud, any
-- IMAP server) just override the four connection fields.

create table if not exists public.mail_accounts (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  email text not null,
  -- The app password (or IMAP password). Full-mailbox credential — the trade
  -- the user accepts for one-string setup; the OAuth path stays available.
  password text not null,
  imap_host text not null default 'imap.gmail.com',
  imap_port integer not null default 993,
  smtp_host text not null default 'smtp.gmail.com',
  smtp_port integer not null default 465,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger mail_accounts_set_updated_at before update on public.mail_accounts
  for each row execute function public.set_updated_at();

alter table public.mail_accounts enable row level security;
create policy "mail_accounts_own" on public.mail_accounts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
