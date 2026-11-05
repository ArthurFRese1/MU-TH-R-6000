-- Scope identity recovery to the already validated campaign, not invite
-- availability. Existing participants may use an expired or rotated invite
-- to request a master-reviewed transfer, without gaining access automatically.

create function public.request_identity_recovery(
  p_campaign_id uuid,
  p_fake_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
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
  if exists (
    select 1 from public.campaign_members m
    where m.campaign_id = p_campaign_id and m.user_id = auth.uid()
  ) then
    raise exception 'Esta identidade já participa da campanha.';
  end if;

  select m.id into v_member_id
  from public.campaign_members m
  where m.campaign_id = p_campaign_id
    and lower(m.fake_email) = v_email
    and not m.is_blocked;
  if v_member_id is null then
    raise exception 'Não há uma participação ativa correspondente nesta campanha.';
  end if;

  insert into public.identity_recovery_requests (
    campaign_id, member_id, requested_user_id
  ) values (
    p_campaign_id, v_member_id, auth.uid()
  ) returning id into v_request_id;
  return v_request_id;
exception
  when unique_violation then
    raise exception 'Já existe uma solicitação pendente para esta identidade.';
end;
$$;

revoke all on function public.request_identity_recovery(uuid, text) from public, anon;
grant execute on function public.request_identity_recovery(uuid, text) to authenticated;
