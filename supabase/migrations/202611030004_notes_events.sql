-- Atomic note publication and narrative event delivery.
-- Run after 202611030003_mail_session_operations.sql.

create or replace function public.save_campaign_note(
  p_campaign_id uuid,
  p_note_id uuid,
  p_notebook_id uuid,
  p_title text,
  p_body text,
  p_visibility text,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_note_id uuid;
  v_recipient_count integer;
  v_distinct_recipient_count integer;
begin
  if not public.is_registered_master() or not public.is_campaign_owner(p_campaign_id) then
    raise exception 'Somente o mestre proprietário pode editar notas desta campanha.';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
    or p_body is null or char_length(p_body) > 30000
    or p_visibility not in ('private', 'published') then
    raise exception 'Informe um título, conteúdo e visibilidade válidos.';
  end if;
  if p_notebook_id is not null and not exists (
    select 1 from public.campaign_notebooks n
    where n.id = p_notebook_id and n.campaign_id = p_campaign_id
  ) then
    raise exception 'O caderno escolhido não pertence a esta campanha.';
  end if;
  if p_visibility = 'private' and coalesce(cardinality(p_member_ids), 0) > 0 then
    raise exception 'Notas privadas não podem possuir destinatários.';
  end if;
  if p_visibility = 'published' and coalesce(cardinality(p_member_ids), 0) = 0 then
    raise exception 'Selecione pelo menos um destinatário para publicar a nota.';
  end if;

  if p_visibility = 'published' then
    select count(distinct m.id) into v_recipient_count
    from public.campaign_members m
    where m.id = any(p_member_ids)
      and m.campaign_id = p_campaign_id
      and not m.is_blocked;
    select count(distinct recipients.member_id) into v_distinct_recipient_count
    from unnest(p_member_ids) as recipients(member_id);
    if v_recipient_count <> cardinality(p_member_ids)
      or v_distinct_recipient_count <> cardinality(p_member_ids) then
      raise exception 'Um ou mais destinatários não pertencem a esta campanha, estão bloqueados ou foram repetidos.';
    end if;
  end if;

  if p_note_id is null then
    insert into public.campaign_notes (
      campaign_id, notebook_id, title, body, visibility, created_by
    ) values (
      p_campaign_id, p_notebook_id, btrim(p_title), p_body, p_visibility, auth.uid()
    ) returning id into v_note_id;
  else
    update public.campaign_notes
    set notebook_id = p_notebook_id,
        title = btrim(p_title),
        body = p_body,
        visibility = p_visibility,
        updated_at = now()
    where id = p_note_id and campaign_id = p_campaign_id
    returning id into v_note_id;
    if v_note_id is null then
      raise exception 'A nota não pertence a esta campanha.';
    end if;
  end if;

  if p_visibility = 'private' then
    delete from public.campaign_notifications
    where content_type = 'note' and content_id = v_note_id and campaign_id = p_campaign_id;
    delete from public.campaign_note_recipients where note_id = v_note_id;
  else
    delete from public.campaign_notifications
    where content_type = 'note' and content_id = v_note_id and campaign_id = p_campaign_id
      and member_id not in (select unnest(p_member_ids));
    delete from public.campaign_note_recipients
    where note_id = v_note_id and member_id not in (select unnest(p_member_ids));

    with newly_published as (
      insert into public.campaign_note_recipients (note_id, member_id)
      select v_note_id, recipients.member_id
      from unnest(p_member_ids) as recipients(member_id)
      on conflict (note_id, member_id) do nothing
      returning member_id
    )
    insert into public.campaign_notifications (
      campaign_id, member_id, content_type, content_id, title
    )
    select p_campaign_id, newly_published.member_id, 'note', v_note_id, btrim(p_title)
    from newly_published;
  end if;

  insert into public.campaign_activity_log (
    campaign_id, actor_user_id, activity_type, description
  ) values (
    p_campaign_id,
    auth.uid(),
    case when p_visibility = 'published' then 'note_published' else 'note_saved' end,
    case when p_visibility = 'published'
      then 'Nota publicada: ' || btrim(p_title)
      else 'Nota privada salva: ' || btrim(p_title)
    end
  );
  return v_note_id;
end;
$$;

create or replace function public.send_campaign_event(
  p_campaign_id uuid,
  p_session_id uuid,
  p_title text,
  p_body text,
  p_event_type text,
  p_presentation text,
  p_is_temporary boolean,
  p_member_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_event_id uuid;
  v_recipient_count integer;
  v_distinct_recipient_count integer;
begin
  if not public.is_registered_master() or not public.is_campaign_owner(p_campaign_id) then
    raise exception 'Somente o mestre proprietário pode disparar eventos nesta campanha.';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
    or p_body is null or char_length(btrim(p_body)) not between 1 and 10000
    or p_event_type not in ('alert', 'urgent', 'terminal', 'failure', 'incident', 'custom')
    or p_presentation not in ('standard', 'emergency', 'quiet') then
    raise exception 'Informe título, conteúdo e apresentação de evento válidos.';
  end if;
  if p_member_ids is null or cardinality(p_member_ids) = 0 then
    raise exception 'Selecione pelo menos um destinatário.';
  end if;
  if p_is_temporary and (p_session_id is null or not exists (
    select 1 from public.campaign_sessions s
    where s.id = p_session_id and s.campaign_id = p_campaign_id and s.ended_at is null
  )) then
    raise exception 'Eventos temporários exigem uma sessão ativa desta campanha.';
  end if;
  if not p_is_temporary and p_session_id is not null and not exists (
    select 1 from public.campaign_sessions s
    where s.id = p_session_id and s.campaign_id = p_campaign_id
  ) then
    raise exception 'A sessão escolhida não pertence a esta campanha.';
  end if;

  select count(distinct m.id) into v_recipient_count
  from public.campaign_members m
  where m.id = any(p_member_ids)
    and m.campaign_id = p_campaign_id
    and not m.is_blocked;
  select count(distinct recipients.member_id) into v_distinct_recipient_count
  from unnest(p_member_ids) as recipients(member_id);
  if v_recipient_count <> cardinality(p_member_ids)
    or v_distinct_recipient_count <> cardinality(p_member_ids) then
    raise exception 'Um ou mais destinatários não pertencem a esta campanha, estão bloqueados ou foram repetidos.';
  end if;

  insert into public.campaign_events (
    campaign_id, session_id, title, body, event_type, presentation, is_temporary, created_by
  ) values (
    p_campaign_id, p_session_id, btrim(p_title), p_body,
    p_event_type, p_presentation, p_is_temporary, auth.uid()
  ) returning id into v_event_id;

  insert into public.campaign_event_recipients (event_id, member_id)
  select v_event_id, recipients.member_id
  from unnest(p_member_ids) as recipients(member_id);
  insert into public.campaign_notifications (
    campaign_id, member_id, content_type, content_id, title
  )
  select p_campaign_id, recipients.member_id, 'event', v_event_id, btrim(p_title)
  from unnest(p_member_ids) as recipients(member_id);
  insert into public.campaign_activity_log (
    campaign_id, actor_user_id, activity_type, description, is_temporary, session_id
  ) values (
    p_campaign_id, auth.uid(), 'event_dispatched',
    'Evento disparado: ' || btrim(p_title), p_is_temporary, p_session_id
  );
  return v_event_id;
end;
$$;

create or replace function public.delete_campaign_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_campaign_id uuid;
  v_title text;
begin
  select campaign_id, title into v_campaign_id, v_title
  from public.campaign_notes where id = p_note_id;
  if v_campaign_id is null or not public.is_registered_master()
    or not public.is_campaign_owner(v_campaign_id) then
    raise exception 'Nota inexistente ou fora da sua campanha.';
  end if;
  delete from public.campaign_notifications
  where campaign_id = v_campaign_id and content_type = 'note' and content_id = p_note_id;
  delete from public.campaign_notes where id = p_note_id;
  insert into public.campaign_activity_log (
    campaign_id, actor_user_id, activity_type, description
  ) values (
    v_campaign_id, auth.uid(), 'note_deleted', 'Nota excluída: ' || v_title
  );
end;
$$;

revoke insert on public.campaign_notes, public.campaign_note_recipients from authenticated;
revoke insert on public.campaign_events, public.campaign_event_recipients from authenticated;
revoke all on function public.save_campaign_note(uuid, uuid, uuid, text, text, text, uuid[]) from public;
revoke all on function public.send_campaign_event(uuid, uuid, text, text, text, text, boolean, uuid[]) from public;
revoke all on function public.delete_campaign_note(uuid) from public;
grant execute on function public.save_campaign_note(uuid, uuid, uuid, text, text, text, uuid[]) to authenticated;
grant execute on function public.send_campaign_event(uuid, uuid, text, text, text, text, boolean, uuid[]) to authenticated;
grant execute on function public.delete_campaign_note(uuid) to authenticated;
