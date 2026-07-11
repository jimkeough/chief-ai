-- =========================================================
-- Secure manual MCP connections
--
-- Public metadata stays behind per-user RLS. Bearer tokens live in Supabase
-- Vault and are reachable only through service-role-only RPCs used by Chief's
-- authenticated server routes. No decrypted secret is exposed to browser roles.
-- =========================================================

create extension if not exists supabase_vault with schema vault;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists public.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 64),
  url text not null check (char_length(url) between 1 and 2048),
  auth_type text not null default 'none' check (auth_type in ('none', 'bearer')),
  app text,
  allowed_tools text[],
  trust_read_annotations boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mcp_connections_user_name_idx
  on public.mcp_connections (user_id, lower(name));

create index if not exists mcp_connections_user_created_idx
  on public.mcp_connections (user_id, created_at);

create trigger mcp_connections_set_updated_at
  before update on public.mcp_connections
  for each row execute function public.set_updated_at();

alter table public.mcp_connections enable row level security;

create policy "mcp_connections_own" on public.mcp_connections
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists private.mcp_connection_secrets (
  connection_id uuid primary key references public.mcp_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  vault_secret_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table private.mcp_connection_secrets from public, anon, authenticated;
grant select, insert, update, delete on table private.mcp_connection_secrets to service_role;

-- Cascade cleanup must remove the encrypted Vault row too, otherwise deleting
-- connection metadata would leave an orphaned credential.
create or replace function private.delete_mcp_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return old;
end;
$$;

revoke all on function private.delete_mcp_vault_secret() from public, anon, authenticated;
alter function private.delete_mcp_vault_secret() owner to postgres;

create trigger mcp_connection_secrets_delete_vault
  before delete on private.mcp_connection_secrets
  for each row execute function private.delete_mcp_vault_secret();

-- These RPCs intentionally use SECURITY INVOKER and are executable only by
-- service_role. Next.js authenticates the user first, then passes the RLS-owned
-- connection id and user id. Browser roles cannot invoke or inspect them.
create or replace function public.chief_mcp_set_secret(
  p_connection_id uuid,
  p_user_id uuid,
  p_secret text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if p_secret is null or btrim(p_secret) = '' then
    raise exception 'secret must be non-empty';
  end if;

  if not exists (
    select 1
    from public.mcp_connections
    where id = p_connection_id and user_id = p_user_id
  ) then
    raise exception 'mcp connection not found';
  end if;

  select vault_secret_id into v_secret_id
  from private.mcp_connection_secrets
  where connection_id = p_connection_id and user_id = p_user_id;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'chief:mcp:' || p_user_id::text || ':' || p_connection_id::text,
      'Chief MCP bearer credential'
    );
    insert into private.mcp_connection_secrets (
      connection_id,
      user_id,
      vault_secret_id
    ) values (
      p_connection_id,
      p_user_id,
      v_secret_id
    );
  else
    perform vault.update_secret(v_secret_id, p_secret);
    update private.mcp_connection_secrets
      set updated_at = now()
      where connection_id = p_connection_id and user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.chief_mcp_delete_secret(
  p_connection_id uuid,
  p_user_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from private.mcp_connection_secrets
  where connection_id = p_connection_id and user_id = p_user_id;
$$;

create or replace function public.chief_mcp_update_connection(
  p_connection_id uuid,
  p_user_id uuid,
  p_name text,
  p_url text,
  p_auth_type text,
  p_app text,
  p_allowed_tools text[],
  p_trust_read_annotations boolean,
  p_secret text,
  p_clear_secret boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.mcp_connections
  set
    name = p_name,
    url = p_url,
    auth_type = p_auth_type,
    app = nullif(btrim(p_app), ''),
    allowed_tools = p_allowed_tools,
    trust_read_annotations = p_trust_read_annotations
  where id = p_connection_id and user_id = p_user_id;

  if not found then
    raise exception 'mcp connection not found';
  end if;

  if p_auth_type = 'none' or p_clear_secret then
    perform public.chief_mcp_delete_secret(p_connection_id, p_user_id);
  elsif p_secret is not null and btrim(p_secret) <> '' then
    perform public.chief_mcp_set_secret(p_connection_id, p_user_id, p_secret);
  elsif not exists (
    select 1
    from private.mcp_connection_secrets
    where connection_id = p_connection_id and user_id = p_user_id
  ) then
    raise exception 'bearer connection requires a stored credential';
  end if;
end;
$$;

create or replace function public.chief_mcp_runtime_secrets(
  p_connection_ids uuid[],
  p_user_id uuid
)
returns table (
  connection_id uuid,
  authorization_token text
)
language sql
security invoker
set search_path = ''
as $$
  select s.connection_id, d.decrypted_secret
  from private.mcp_connection_secrets s
  join vault.decrypted_secrets d on d.id = s.vault_secret_id
  where
    s.user_id = p_user_id
    and s.connection_id = any(coalesce(p_connection_ids, array[]::uuid[]));
$$;

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

grant select, insert, update, delete on vault.secrets to service_role;
grant select on vault.decrypted_secrets to service_role;
grant execute on function vault.create_secret(text, text, text, uuid) to service_role;
grant execute on function vault.update_secret(uuid, text, text, text, uuid) to service_role;

