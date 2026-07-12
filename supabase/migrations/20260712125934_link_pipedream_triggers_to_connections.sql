-- Proactive Pipedream triggers belong to one logical connected account.
-- The connection foreign key keeps multi-account apps isolated and removes
-- the local trigger registry entry when its account is disconnected.

alter table public.chief_triggers
  add column if not exists connection_id uuid
    references public.pipedream_connections(id) on delete cascade;

-- Rows created by the retired shared Chief Connect service cannot be proved to
-- belong to an account in the owner's new Pipedream project. Revoke their
-- webhook tokens; the owner can re-enable the desired notifications here.
delete from public.chief_triggers
where connection_id is null;

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
