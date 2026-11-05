-- Let an anonymous replacement identity ask the campaign owner to transfer
-- an existing participation. A request never transfers access by itself.
-- Run after 202611030007_character_sheet_name.sql.

create or replace function public.request_identity_recovery(
  p_invite_code text,
  p_fake_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_campaign_id uuid;
  v_member_id uuid;
  v_request_id uuid;
  v_email text := lower(btrim(coalesce(p_fake_email, '')));
begin
  if auth.uid() is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A recuperação requer uma nova sessão anônima de jogador.';
  end if;
  if v_email !~* '^[^@[:space:]]+@gmail\.com$' then
    raise exception 'Informe o e-mail fictício usado na participação original.';
  end if;

  select i.campaign_id into v_campaign_id
  from public.campaign_invites i
  where i.code = upper(btrim(coalesce(p_invite_code, '')))
    and i.is_active
    and (i.valid_until is null or i.valid_until > now())
    and (i.max_uses is null or i.uses < i.max_uses)
  limit 1;
  if v_campaign_id is null then
    raise exception 'Convite inválido, expirado ou sem utilizações disponíveis.';
  end if;
  if exists (
    select 1 from public.campaign_members m
    where m.campaign_id = v_campaign_id and m.user_id = auth.uid()
  ) then
    raise exception 'Esta identidade já participa da campanha.';
  end if;

  select m.id into v_member_id
  from public.campaign_members m
  where m.campaign_id = v_campaign_id
    and lower(m.fake_email) = v_email
    and not m.is_blocked;
  if v_member_id is null then
    raise exception 'Não há uma participação ativa correspondente nesta campanha.';
  end if;

  insert into public.identity_recovery_requests (
    campaign_id, member_id, requested_user_id
  ) values (
    v_campaign_id, v_member_id, auth.uid()
  ) returning id into v_request_id;
  return v_request_id;
exception
  when unique_violation then
    raise exception 'Já existe uma solicitação pendente para esta identidade.';
end;
$$;

revoke all on function public.request_identity_recovery(text, text) from public, anon;
grant execute on function public.request_identity_recovery(text, text) to authenticated;

revoke insert, update, delete on public.identity_recovery_requests from authenticated;
grant select on public.identity_recovery_requests to authenticated;

create or replace function public.log_identity_recovery_activity()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_player_name text;
begin
  select m.player_name into v_player_name
  from public.campaign_members m where m.id = new.member_id;

  if tg_op = 'INSERT' then
    insert into public.campaign_activity_log (
      campaign_id, actor_user_id, actor_member_id, activity_type, description
    ) values (
      new.campaign_id,
      new.requested_user_id,
      new.member_id,
      'identity_recovery_requested',
      'Solicitação de recuperação recebida para: ' || coalesce(v_player_name, 'participação')
    );
  elsif new.status is distinct from old.status then
    insert into public.campaign_activity_log (
      campaign_id, actor_user_id, actor_member_id, activity_type, description
    ) values (
      new.campaign_id,
      new.resolved_by,
      new.member_id,
      case when new.status = 'approved' then 'identity_recovery_approved' else 'identity_recovery_rejected' end,
      case when new.status = 'approved' then 'Recuperação autorizada para: ' else 'Recuperação recusada para: ' end
        || coalesce(v_player_name, 'participação')
    );
  end if;
  return new;
end;
$$;

create trigger identity_recovery_activity_after_insert
  after insert on public.identity_recovery_requests
  for each row execute function public.log_identity_recovery_activity();
create trigger identity_recovery_activity_after_update
  after update of status on public.identity_recovery_requests
  for each row execute function public.log_identity_recovery_activity();
revoke all on function public.log_identity_recovery_activity() from public, anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.identity_recovery_requests;
exception
  when duplicate_object then null;
end;
$$;
