-- Local-dev seed (Supabase CLI): runs after migrations on `supabase start` /
-- `supabase db reset`. It does NOT run against hosted Supabase, and it does not
-- seed any application rows.
--
-- Why this exists: Chief's migrations intentionally carry no GRANT statements —
-- on hosted Supabase the anon/authenticated/service_role roles receive DML on
-- new public tables automatically via that project's default privileges. Some
-- local Supabase CLI stacks create tables owned by `postgres` whose default
-- privileges only grant TRUNCATE/REFERENCES/TRIGGER to those roles, so RLS-
-- gated reads/writes fail with "permission denied for table ...". These grants
-- reproduce the hosted behavior for local development only.

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Secret-bearing MCP RPCs are server-only. The broad local grants above mirror
-- hosted defaults for ordinary app objects, then these explicit revokes restore
-- the production boundary for credentials.
revoke all on function public.chief_mcp_set_secret(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.chief_mcp_delete_secret(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.chief_mcp_update_connection(
  uuid, uuid, text, text, text, text, text[], boolean, text, boolean
)
  from public, anon, authenticated;
revoke all on function public.chief_mcp_runtime_secrets(uuid[], uuid)
  from public, anon, authenticated;

grant execute on function public.chief_mcp_set_secret(uuid, uuid, text)
  to service_role;
grant execute on function public.chief_mcp_delete_secret(uuid, uuid)
  to service_role;
grant execute on function public.chief_mcp_update_connection(
  uuid, uuid, text, text, text, text, text[], boolean, text, boolean
)
  to service_role;
grant execute on function public.chief_mcp_runtime_secrets(uuid[], uuid)
  to service_role;

-- Pipedream OAuth client credentials use the same write-only Vault boundary.
revoke all on function public.chief_pipedream_upsert_config(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.chief_pipedream_runtime_config(uuid)
  from public, anon, authenticated;
revoke all on function public.chief_pipedream_delete_config(uuid)
  from public, anon, authenticated;

grant execute on function public.chief_pipedream_upsert_config(uuid, text, text, text)
  to service_role;
grant execute on function public.chief_pipedream_runtime_config(uuid)
  to service_role;
grant execute on function public.chief_pipedream_delete_config(uuid)
  to service_role;

-- Official Front MCP OAuth credentials and user tokens are also server-only.
revoke all on function public.chief_front_upsert_config(uuid, text, text, text[])
  from public, anon, authenticated;
revoke all on function public.chief_front_store_tokens(uuid, text, timestamptz, text[])
  from public, anon, authenticated;
revoke all on function public.chief_front_runtime_config(uuid)
  from public, anon, authenticated;
revoke all on function public.chief_front_delete_config(uuid)
  from public, anon, authenticated;

grant execute on function public.chief_front_upsert_config(uuid, text, text, text[])
  to service_role;
grant execute on function public.chief_front_store_tokens(uuid, text, timestamptz, text[])
  to service_role;
grant execute on function public.chief_front_runtime_config(uuid)
  to service_role;
grant execute on function public.chief_front_delete_config(uuid)
  to service_role;
