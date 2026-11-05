-- Validate file recipients at the database boundary and protect email images.
-- Run after 202611030004_notes_events.sql.

create or replace function public.distribute_campaign_file(p_file_id uuid, p_member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_campaign_id uuid;
  v_file_name text;
  v_recipient_count integer;
  v_distinct_recipient_count integer;
begin
  select campaign_id, file_name into v_campaign_id, v_file_name
  from public.campaign_files where id = p_file_id;
  if v_campaign_id is null or not public.is_registered_master()
    or not public.is_campaign_owner(v_campaign_id) then
    raise exception 'Arquivo inexistente ou fora da sua campanha.';
  end if;
  if p_member_ids is null or cardinality(p_member_ids) = 0 then
    raise exception 'Selecione pelo menos um destinatário para o arquivo.';
  end if;

  select count(distinct m.id) into v_recipient_count
  from public.campaign_members m
  where m.id = any(p_member_ids)
    and m.campaign_id = v_campaign_id
    and not m.is_blocked;
  select count(distinct recipients.member_id) into v_distinct_recipient_count
  from unnest(p_member_ids) as recipients(member_id);
  if v_recipient_count <> cardinality(p_member_ids)
    or v_distinct_recipient_count <> cardinality(p_member_ids) then
    raise exception 'Um ou mais destinatários não pertencem a esta campanha, estão bloqueados ou foram repetidos.';
  end if;

  delete from public.campaign_notifications
  where campaign_id = v_campaign_id and content_type = 'file' and content_id = p_file_id
    and member_id not in (select unnest(p_member_ids));
  delete from public.campaign_file_recipients
  where file_id = p_file_id and member_id not in (select unnest(p_member_ids));

  with newly_distributed as (
    insert into public.campaign_file_recipients (file_id, member_id)
    select p_file_id, recipients.member_id
    from unnest(p_member_ids) as recipients(member_id)
    on conflict (file_id, member_id) do nothing
    returning member_id
  )
  insert into public.campaign_notifications (
    campaign_id, member_id, content_type, content_id, title
  )
  select v_campaign_id, newly_distributed.member_id, 'file', p_file_id, v_file_name
  from newly_distributed;

  insert into public.campaign_activity_log (
    campaign_id, actor_user_id, activity_type, description
  ) values (
    v_campaign_id, auth.uid(), 'file_distributed',
    'Arquivo distribuído: ' || v_file_name
  );
end;
$$;

drop policy if exists "Owners can assign file recipients" on public.campaign_file_recipients;
create policy "Owners can assign file recipients in their campaign"
  on public.campaign_file_recipients for insert to authenticated
  with check (
    exists (
      select 1 from public.campaign_files f
      join public.campaign_members m on m.id = member_id
        and m.campaign_id = f.campaign_id and not m.is_blocked
      where f.id = file_id and public.is_campaign_owner(f.campaign_id)
    )
  );

create or replace function public.clear_file_notifications_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.campaign_notifications
  where campaign_id = old.campaign_id and content_type = 'file' and content_id = old.id;
  return old;
end;
$$;
create trigger clear_file_notifications_after_delete
  after delete on public.campaign_files
  for each row execute function public.clear_file_notifications_on_delete();
revoke all on function public.clear_file_notifications_on_delete() from public;

revoke insert on public.campaign_file_recipients from authenticated;
revoke all on function public.distribute_campaign_file(uuid, uuid[]) from public;
grant execute on function public.distribute_campaign_file(uuid, uuid[]) to authenticated;
