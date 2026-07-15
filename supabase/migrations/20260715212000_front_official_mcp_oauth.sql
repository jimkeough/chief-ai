-- =========================================================
-- Official Front MCP OAuth configuration
--
-- The Front developer-app client secret and user OAuth tokens live together
-- in Supabase Vault. Browser roles may read only their non-secret connection
-- metadata; authenticated Chief server routes use service-role-only RPCs after
-- verifying the signed-in user.
-- =========================================================

create table if not exists public.front_oauth_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null check (char_length(btrim(client_id)) between 1 and 512),
  scopes text[] not null default array['read', 'write']::text[],
  connected_at timestamptz,
  access_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger front_oauth_config_set_updated_at
  before update on public.front_oauth_config
  for each row execute function public.set_updated_at();

alter table public.front_oauth_config enable row level security;

create policy "front_oauth_config_select_own" on public.front_oauth_config
  for select to authenticated
  using (user_id = (select auth.uid()));

create table if not exists private.front_oauth_secrets (
  user_id uuid primary key references public.front_oauth_config(user_id) on delete cascade,
  vault_secret_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table private.front_oauth_secrets from public, anon, authenticated;
grant select, insert, update, delete on table private.front_oauth_secrets to service_role;

create or replace function private.delete_front_oauth_vault_secret()
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

revoke all on function private.delete_front_oauth_vault_secret()
  from public, anon, authenticated;
alter function private.delete_front_oauth_vault_secret() owner to postgres;

create trigger front_oauth_secrets_delete_vault
  before delete on private.front_oauth_secrets
  for each row execute function private.delete_front_oauth_vault_secret();

-- Saving developer-app credentials deliberately clears any previous grant.
-- A changed client id/secret must be authorized again before it can be used.
create or replace function public.chief_front_upsert_config(
  p_user_id uuid,
  p_client_id text,
  p_client_secret text,
  p_scopes text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_payload text;
begin
  if p_client_id is null or btrim(p_client_id) = '' then
    raise exception 'Front client id must be non-empty';
  end if;
  if p_client_secret is null or btrim(p_client_secret) = '' then
    raise exception 'Front client secret must be non-empty';
  end if;
  if p_scopes is null
    or cardinality(p_scopes) = 0
    or p_scopes <@ array['read', 'write', 'send']::text[] is not true
  then
    raise exception 'Front scopes must contain only read, write, or send';
  end if;

  insert into public.front_oauth_config (
    user_id,
    client_id,
    scopes,
    connected_at,
    access_token_expires_at
  )
  values (p_user_id, btrim(p_client_id), p_scopes, null, null)
  on conflict (user_id) do update
    set client_id = excluded.client_id,
        scopes = excluded.scopes,
        connected_at = null,
        access_token_expires_at = null;

  v_payload := jsonb_build_object('clientSecret', p_client_secret)::text;

  select vault_secret_id into v_secret_id
  from private.front_oauth_secrets
  where user_id = p_user_id;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      v_payload,
      'chief:front:oauth:' || p_user_id::text,
      'Chief official Front MCP OAuth credentials and tokens'
    );
    insert into private.front_oauth_secrets (user_id, vault_secret_id)
    values (p_user_id, v_secret_id);
  else
    perform vault.update_secret(v_secret_id, v_payload);
    update private.front_oauth_secrets
      set updated_at = now()
      where user_id = p_user_id;
  end if;
end;
$$;

-- Token payload is JSON and is merged into the existing Vault object so the
-- developer-app client secret remains write-only while access tokens rotate.
create or replace function public.chief_front_store_tokens(
  p_user_id uuid,
  p_token_payload text,
  p_expires_at timestamptz,
  p_scopes text[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_existing jsonb;
  v_tokens jsonb;
begin
  if p_token_payload is null or btrim(p_token_payload) = '' then
    raise exception 'Front token payload must be non-empty';
  end if;
  v_tokens := p_token_payload::jsonb;
  if nullif(v_tokens ->> 'accessToken', '') is null
    or nullif(v_tokens ->> 'refreshToken', '') is null
  then
    raise exception 'Front access and refresh tokens are required';
  end if;

  select s.vault_secret_id, d.decrypted_secret::jsonb
    into v_secret_id, v_existing
  from private.front_oauth_secrets s
  join vault.decrypted_secrets d on d.id = s.vault_secret_id
  where s.user_id = p_user_id;

  if v_secret_id is null or nullif(v_existing ->> 'clientSecret', '') is null then
    raise exception 'Front OAuth credentials are not configured';
  end if;

  perform vault.update_secret(v_secret_id, (v_existing || v_tokens)::text);
  update private.front_oauth_secrets
    set updated_at = now()
    where user_id = p_user_id;

  update public.front_oauth_config
    set connected_at = coalesce(connected_at, now()),
        access_token_expires_at = p_expires_at,
        scopes = coalesce(p_scopes, scopes)
    where user_id = p_user_id;
end;
$$;

create or replace function public.chief_front_runtime_config(
  p_user_id uuid
)
returns table (
  client_id text,
  scopes text[],
  connected_at timestamptz,
  access_token_expires_at timestamptz,
  credentials text
)
language sql
security invoker
set search_path = ''
as $$
  select
    c.client_id,
    c.scopes,
    c.connected_at,
    c.access_token_expires_at,
    d.decrypted_secret
  from public.front_oauth_config c
  join private.front_oauth_secrets s on s.user_id = c.user_id
  join vault.decrypted_secrets d on d.id = s.vault_secret_id
  where c.user_id = p_user_id;
$$;

create or replace function public.chief_front_delete_config(
  p_user_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.front_oauth_config where user_id = p_user_id;
$$;

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
