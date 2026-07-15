-- =========================================================
-- Front OAuth scope correction
--
-- Front's authorization server only supports `feature:mcp` for the hosted
-- MCP server. Read / Write / Send are Front developer-app Resource
-- permissions, not OAuth scopes. Requesting them returns invalid_scope.
-- =========================================================

update public.front_oauth_config
  set scopes = array['feature:mcp']::text[];

alter table public.front_oauth_config
  alter column scopes set default array['feature:mcp']::text[];

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
  v_scopes text[] := array['feature:mcp']::text[];
begin
  if p_client_id is null or btrim(p_client_id) = '' then
    raise exception 'Front client id must be non-empty';
  end if;
  if p_client_secret is null or btrim(p_client_secret) = '' then
    raise exception 'Front client secret must be non-empty';
  end if;
  -- Accept legacy callers that still pass read/write/send, then store the
  -- only scope Front's authorization server accepts.
  if p_scopes is not null and cardinality(p_scopes) > 0 then
    if not (
      p_scopes <@ array['feature:mcp', 'read', 'write', 'send']::text[]
      and (
        'feature:mcp' = any (p_scopes)
        or 'read' = any (p_scopes)
        or 'write' = any (p_scopes)
        or 'send' = any (p_scopes)
      )
    ) then
      raise exception 'Front MCP OAuth only supports the feature:mcp scope';
    end if;
  end if;

  insert into public.front_oauth_config (
    user_id,
    client_id,
    scopes,
    connected_at,
    access_token_expires_at
  )
  values (p_user_id, btrim(p_client_id), v_scopes, null, null)
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
        scopes = array['feature:mcp']::text[]
    where user_id = p_user_id;
end;
$$;

revoke all on function public.chief_front_upsert_config(uuid, text, text, text[])
  from public, anon, authenticated;
revoke all on function public.chief_front_store_tokens(uuid, text, timestamptz, text[])
  from public, anon, authenticated;

grant execute on function public.chief_front_upsert_config(uuid, text, text, text[])
  to service_role;
grant execute on function public.chief_front_store_tokens(uuid, text, timestamptz, text[])
  to service_role;
