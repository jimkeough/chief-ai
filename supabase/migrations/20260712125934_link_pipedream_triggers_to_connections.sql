-- Proactive Pipedream triggers belong to one logical connected account.
-- The connection foreign key keeps multi-account apps isolated and removes
-- the local trigger registry entry when its account is disconnected.

alter table public.chief_triggers
  add column if not exists connection_id uuid
    references public.pipedream_connections(id) on delete cascade;

-- Preserve triggers from the former Chief Connect UI when exactly one current
-- account matches their user + app. Ambiguous multi-account rows stay visible
-- only as legacy data rather than being attached to the wrong credential.
with unambiguous_connections as (
  select user_id, app_slug, min(id::text)::uuid as connection_id
  from public.pipedream_connections
  group by user_id, app_slug
  having count(*) = 1
)
update public.chief_triggers as t
set connection_id = c.connection_id
from unambiguous_connections as c
where t.connection_id is null
  and t.user_id = c.user_id
  and t.app = c.app_slug;

create unique index if not exists chief_triggers_connection_component_idx
  on public.chief_triggers (user_id, connection_id, component_id)
  where connection_id is not null and component_id is not null;

-- Pipedream payload ids are only meaningful within one deployed trigger.
-- Scope delivery deduplication accordingly so two triggers can report the
-- same upstream resource without suppressing each other.
drop index if exists public.chief_events_dedup_idx;

create unique index chief_events_dedup_idx
  on public.chief_events (trigger_id, external_event_id)
  where trigger_id is not null and external_event_id is not null;
