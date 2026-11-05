create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $migration$
declare
  v_pgcrypto_schema name;
begin
  select namespace.nspname
  into v_pgcrypto_schema
  from pg_extension extension
  join pg_namespace namespace on namespace.oid = extension.extnamespace
  join pg_proc function_entry
    on function_entry.pronamespace = namespace.oid
   and function_entry.proname = 'gen_random_bytes'
   and pg_get_function_identity_arguments(function_entry.oid) = 'integer'
  where extension.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto.gen_random_bytes(integer) is unavailable after enabling pgcrypto.';
  end if;

  execute format($function$
    create or replace function public.create_campaign(p_name text, p_description text default '')
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, auth, pg_temp
    as $body$
    declare
      v_campaign_id uuid;
      v_code text;
    begin
      if auth.uid() is null or not public.is_registered_master() then
        raise exception 'Somente uma conta de mestre confirmada pode criar campanhas.';
      end if;
      if char_length(btrim(coalesce(p_name, ''))) not between 1 and 100 then
        raise exception 'O nome da campanha deve conter entre 1 e 100 caracteres.';
      end if;
      insert into public.campaigns (owner_id, name, description)
      values (auth.uid(), btrim(p_name), coalesce(p_description, ''))
      returning id into v_campaign_id;
      v_code := upper(encode(%I.gen_random_bytes(16), 'hex'));
      insert into public.campaign_invites (campaign_id, code)
      values (v_campaign_id, v_code);
      insert into public.campaign_settings (campaign_id) values (v_campaign_id);
      return jsonb_build_object('campaign_id', v_campaign_id, 'invite_code', v_code);
    end;
    $body$;
  $function$, v_pgcrypto_schema);

  execute format($function$
    create or replace function public.rotate_campaign_invite(
      p_campaign_id uuid,
      p_valid_until timestamptz default null,
      p_max_uses integer default null
    )
    returns text
    language plpgsql
    security definer
    set search_path = public, auth, pg_temp
    as $body$
    declare
      v_code text;
    begin
      if not public.is_registered_master() or not public.is_campaign_owner(p_campaign_id) then
        raise exception 'Apenas o mestre proprietário pode renovar o convite.';
      end if;
      if p_max_uses is not null and p_max_uses < 1 then
        raise exception 'O limite de utilizações deve ser maior que zero.';
      end if;
      update public.campaign_invites
      set is_active = false
      where campaign_id = p_campaign_id and is_active;
      v_code := upper(encode(%I.gen_random_bytes(16), 'hex'));
      insert into public.campaign_invites (campaign_id, code, valid_until, max_uses)
      values (p_campaign_id, v_code, p_valid_until, p_max_uses);
      return v_code;
    end;
    $body$;
  $function$, v_pgcrypto_schema);
end;
$migration$;
