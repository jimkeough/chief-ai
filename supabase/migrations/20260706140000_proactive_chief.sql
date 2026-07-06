-- Proactive Chief: the app can now be pushed to. Two tables, same tenancy as
-- everything else (user_id → auth.users, RLS does the work).
--
-- chief_triggers — the registry of deployed Pipedream triggers, one row per
-- "notify me when…" the user turned on. Holds the webhook signing key so the
-- ingest endpoint can verify deliveries.
--
-- chief_events — append-only inbound events, plus the OPTIONAL proposal Chief
-- derived from each one. Proposals surface on Home / the Chief bar and run
-- through the same executor gate on approval; nothing here ever auto-acts.

create table if not exists public.chief_triggers (
  id text primary key, -- Pipedream deployed-trigger id (dc_…)
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  app text not null,
  component_id text,
  name text,
  signing_key text,
  -- Unguessable secret embedded in this trigger's webhook URL; the ingest
  -- endpoint resolves the event's owner by matching it (the URL is shared only
  -- with Pipedream, so possession of the token is the auth). Pipedream's
  -- signature is verified on top when a signing key is present.
  token text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists chief_triggers_token_idx
  on public.chief_triggers (token);

alter table public.chief_triggers enable row level security;
create policy "chief_triggers_own" on public.chief_triggers for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.chief_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trigger_id text,
  app text,
  -- Pipedream's event id, when present, so redelivery doesn't double-count.
  external_event_id text,
  -- One-line human summary of what arrived ("Rakesh added a task to FastExpert").
  summary text,
  -- Optional derived proposal: the write-action key + args, rendered as a card.
  -- Null when the event is informational only (it still updates state / log).
  proposal jsonb,
  status text not null default 'new'
    check (status in ('new', 'acted', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists chief_events_user_status_idx
  on public.chief_events (user_id, status, created_at desc);
-- Dedup guard: the same delivered event is recorded at most once per user.
create unique index if not exists chief_events_dedup_idx
  on public.chief_events (user_id, external_event_id)
  where external_event_id is not null;

alter table public.chief_events enable row level security;
create policy "chief_events_own" on public.chief_events for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
