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
