-- Allow the campaign owner to revoke every currently active invite without
-- exposing direct write access to campaign_invites.
create or replace function public.invalidate_campaign_invites(p_campaign_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_invalidated integer;
begin
  if not public.is_registered_master() or not public.is_campaign_owner(p_campaign_id) then
    raise exception 'Apenas o mestre proprietário pode invalidar convites.';
  end if;

  update public.campaign_invites
  set is_active = false
  where campaign_id = p_campaign_id and is_active;
  get diagnostics v_invalidated = row_count;

  if v_invalidated > 0 then
    insert into public.campaign_activity_log (
      campaign_id, actor_user_id, activity_type, description
    ) values (
      p_campaign_id, auth.uid(), 'campaign_invites_invalidated',
      'Convites ativos invalidados pelo mestre.'
    );
  end if;
  return v_invalidated;
end;
$$;

revoke all on function public.invalidate_campaign_invites(uuid) from public, anon;
grant execute on function public.invalidate_campaign_invites(uuid) to authenticated;
