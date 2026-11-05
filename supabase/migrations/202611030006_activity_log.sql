-- Record membership lifecycle events and publish the owner-visible activity log.
-- Run after 202611030005_file_distribution.sql.

create or replace function public.log_campaign_member_join()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.campaign_activity_log (
    campaign_id, actor_user_id, actor_member_id, activity_type, description
  ) values (
    new.campaign_id,
    new.user_id,
    new.id,
    'player_joined',
    'Jogador entrou na campanha: ' || new.player_name
  );
  return new;
end;
$$;

create trigger campaign_member_join_activity
  after insert on public.campaign_members
  for each row execute function public.log_campaign_member_join();

create or replace function public.log_campaign_member_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if new.is_blocked is distinct from old.is_blocked then
    insert into public.campaign_activity_log (
      campaign_id, actor_user_id, actor_member_id, activity_type, description
    ) values (
      new.campaign_id,
      auth.uid(),
      new.id,
      case when new.is_blocked then 'player_blocked' else 'player_unblocked' end,
      case when new.is_blocked then 'Jogador bloqueado: ' else 'Acesso do jogador restaurado: ' end || new.player_name
    );
  end if;
  return new;
end;
$$;

create trigger campaign_member_status_activity
  after update of is_blocked on public.campaign_members
  for each row execute function public.log_campaign_member_status_change();

create or replace function public.log_campaign_member_removal()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  insert into public.campaign_activity_log (
    campaign_id, actor_user_id, activity_type, description
  ) values (
    old.campaign_id,
    auth.uid(),
    'player_removed',
    'Jogador removido da campanha: ' || old.player_name
  );
  return old;
end;
$$;

create trigger campaign_member_removal_activity
  before delete on public.campaign_members
  for each row execute function public.log_campaign_member_removal();

revoke all on function public.log_campaign_member_join() from public, anon, authenticated;
revoke all on function public.log_campaign_member_status_change() from public, anon, authenticated;
revoke all on function public.log_campaign_member_removal() from public, anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.campaign_activity_log;
exception
  when duplicate_object then null;
end;
$$;
