-- Atomic mail delivery and explicit session cleanup operations.
-- Run after 202611030002_campaign_modules.sql.

alter table public.global_messages
  add column if not exists session_id uuid references public.campaign_sessions (id) on delete set null;
alter table public.local_messages
  add column if not exists session_id uuid references public.campaign_sessions (id) on delete set null;
alter table public.campaign_events
  add column if not exists session_id uuid references public.campaign_sessions (id) on delete set null;
alter table public.campaign_events
  add column if not exists is_temporary boolean not null default false;
alter table public.campaign_activity_log
  add column if not exists session_id uuid references public.campaign_sessions (id) on delete set null;
alter table public.campaign_activity_log
  add column if not exists is_temporary boolean not null default false;

create index if not exists global_messages_session_idx
  on public.global_messages (session_id) where session_id is not null;
create index if not exists local_messages_session_idx
  on public.local_messages (session_id) where session_id is not null;
create index if not exists campaign_events_session_idx
  on public.campaign_events (session_id) where session_id is not null;
create index if not exists campaign_activity_log_session_idx
  on public.campaign_activity_log (session_id) where session_id is not null;

create or replace function public.send_campaign_email(
  p_campaign_id uuid,
  p_sender_email text,
  p_sender_name text,
  p_subject text,
  p_body text,
  p_member_ids uuid[],
  p_file_ids uuid[] default '{}',
  p_reply_to_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email_id uuid;
  v_recipient_count integer;
  v_distinct_recipient_count integer;
  v_file_count integer;
  v_distinct_file_count integer;
begin
  if not public.is_registered_master() or not public.is_campaign_owner(p_campaign_id) then
    raise exception 'Somente o mestre proprietário pode enviar e-mails nesta campanha.';
  end if;
  if p_sender_email is null
    or p_sender_email !~* '^[^@[:space:]]+@[^@[:space:]]+$'
    or p_sender_name is null or char_length(btrim(p_sender_name)) not between 1 and 100
    or p_subject is null or char_length(btrim(p_subject)) not between 1 and 200
    or p_body is null or char_length(btrim(p_body)) not between 1 and 20000 then
    raise exception 'Informe remetente, assunto e conteúdo válidos.';
  end if;
  if p_member_ids is null or cardinality(p_member_ids) = 0 then
    raise exception 'Selecione pelo menos um destinatário.';
  end if;

  select count(distinct m.id) into v_recipient_count
  from public.campaign_members m
  where m.id = any(p_member_ids)
    and m.campaign_id = p_campaign_id
    and not m.is_blocked;
  select count(distinct recipients.recipient_id) into v_distinct_recipient_count
  from unnest(p_member_ids) as recipients(recipient_id);
  if v_recipient_count <> cardinality(p_member_ids)
    or v_distinct_recipient_count <> cardinality(p_member_ids) then
    raise exception 'Um ou mais destinatários não pertencem a esta campanha, estão bloqueados ou foram repetidos.';
  end if;

  if p_file_ids is null then
    raise exception 'A lista de imagens anexadas é inválida.';
  end if;
  select count(distinct f.id) into v_file_count
  from public.campaign_files f
  where f.id = any(p_file_ids)
    and f.campaign_id = p_campaign_id
    and f.mime_type like 'image/%';
  select count(distinct files.file_id) into v_distinct_file_count
  from unnest(p_file_ids) as files(file_id);
  if v_file_count <> cardinality(p_file_ids)
    or v_distinct_file_count <> cardinality(p_file_ids) then
    raise exception 'Uma ou mais imagens não pertencem a esta campanha ou são inválidas.';
  end if;

  if p_reply_to_id is not null and not exists (
    select 1 from public.campaign_emails original
    where original.id = p_reply_to_id and original.campaign_id = p_campaign_id
  ) then
    raise exception 'O e-mail original não pertence a esta campanha.';
  end if;

  insert into public.campaign_emails (
    campaign_id, sender_email, sender_name, subject, body, sent_by, reply_to_id
  ) values (
    p_campaign_id, lower(btrim(p_sender_email)), btrim(p_sender_name),
    btrim(p_subject), p_body, auth.uid(), p_reply_to_id
  ) returning id into v_email_id;

  insert into public.campaign_email_recipients (email_id, member_id)
  select v_email_id, recipients.recipient_id from unnest(p_member_ids) as recipients(recipient_id);
  insert into public.campaign_notifications (
    campaign_id, member_id, content_type, content_id, title
  )
  select p_campaign_id, recipients.recipient_id, 'email', v_email_id, btrim(p_subject)
  from unnest(p_member_ids) as recipients(recipient_id);
  insert into public.campaign_email_images (email_id, file_id)
  select v_email_id, files.file_id from unnest(p_file_ids) as files(file_id);
  insert into public.campaign_activity_log (
    campaign_id, actor_user_id, activity_type, description
  ) values (
    p_campaign_id, auth.uid(), 'email_sent', 'E-mail interno enviado: ' || btrim(p_subject)
  );
  return v_email_id;
end;
$$;

create or replace function public.reply_to_campaign_email(p_email_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_original public.campaign_emails%rowtype;
  v_member public.campaign_members%rowtype;
  v_reply_id uuid;
begin
  if not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or p_body is null or char_length(btrim(p_body)) not between 1 and 20000 then
    raise exception 'Resposta inválida.';
  end if;

  select * into v_original from public.campaign_emails where id = p_email_id;
  if not found or not public.can_read_campaign_email(p_email_id) then
    raise exception 'E-mail não encontrado ou sem permissão para responder.';
  end if;
  if not exists (
    select 1 from public.campaign_settings s
    where s.campaign_id = v_original.campaign_id and s.allow_player_email_replies
  ) then
    raise exception 'O mestre não habilitou respostas a e-mails.';
  end if;
  select * into v_member from public.campaign_members
  where campaign_id = v_original.campaign_id and user_id = auth.uid() and not is_blocked;
  if not found then
    raise exception 'A participação não está ativa nesta campanha.';
  end if;

  insert into public.campaign_emails (
    campaign_id, sender_email, sender_name, subject, body, sent_by, reply_to_id
  ) values (
    v_original.campaign_id, v_member.fake_email, v_member.player_name,
    left('Re: ' || v_original.subject, 200), p_body, auth.uid(), p_email_id
  ) returning id into v_reply_id;

  insert into public.campaign_activity_log (
    campaign_id, actor_member_id, activity_type, description
  ) values (
    v_original.campaign_id, v_member.id, 'email_received',
    'Resposta recebida: ' || left(v_original.subject, 800)
  );
  return v_reply_id;
end;
$$;

create or replace function public.end_campaign_session(
  p_session_id uuid,
  p_clear_global_chat boolean,
  p_clear_local_chat boolean,
  p_clear_temporary_activity boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_campaign_id uuid;
  v_global_count integer := 0;
  v_local_count integer := 0;
  v_activity_count integer := 0;
begin
  select s.campaign_id into v_campaign_id
  from public.campaign_sessions s
  where s.id = p_session_id and s.ended_at is null
  for update;
  if v_campaign_id is null or not public.is_registered_master()
    or not public.is_campaign_owner(v_campaign_id) then
    raise exception 'Sessão inexistente, encerrada ou fora da sua campanha.';
  end if;

  if p_clear_global_chat then
    delete from public.global_messages where session_id = p_session_id;
    get diagnostics v_global_count = row_count;
  end if;
  if p_clear_local_chat then
    delete from public.local_messages where session_id = p_session_id;
    get diagnostics v_local_count = row_count;
  end if;
  if p_clear_temporary_activity then
    delete from public.campaign_activity_log
    where session_id = p_session_id and is_temporary;
    get diagnostics v_activity_count = row_count;
    delete from public.campaign_notifications
    where campaign_id = v_campaign_id
      and content_type = 'event'
      and content_id in (
        select id from public.campaign_events
        where session_id = p_session_id and is_temporary
      );
    delete from public.campaign_events
    where session_id = p_session_id and is_temporary;
  end if;

  delete from public.chat_typing_indicators where campaign_id = v_campaign_id;
  update public.campaign_sessions set ended_at = now() where id = p_session_id;
  insert into public.campaign_activity_log (
    campaign_id, actor_user_id, activity_type, description, is_temporary
  ) values (
    v_campaign_id, auth.uid(), 'session_ended', 'Sessão encerrada pelo mestre.', false
  );
  return jsonb_build_object(
    'global_messages_deleted', v_global_count,
    'local_messages_deleted', v_local_count,
    'temporary_activity_deleted', v_activity_count,
    'ended_at', now()
  );
end;
$$;

drop policy if exists "Players can reply when campaign permits it" on public.campaign_emails;
drop policy if exists "Owners and addressed players can read emails" on public.campaign_emails;
create policy "Owners and addressed players can read emails"
  on public.campaign_emails for select to authenticated
  using (public.is_campaign_owner(campaign_id) or public.can_read_campaign_email(id) or sent_by = auth.uid());

revoke insert on public.campaign_emails from authenticated;
revoke all on function public.send_campaign_email(uuid, text, text, text, text, uuid[], uuid[], uuid) from public;
revoke all on function public.reply_to_campaign_email(uuid, text) from public;
revoke all on function public.end_campaign_session(uuid, boolean, boolean, boolean) from public;
grant execute on function public.send_campaign_email(uuid, text, text, text, text, uuid[], uuid[], uuid) to authenticated;
grant execute on function public.reply_to_campaign_email(uuid, text) to authenticated;
grant execute on function public.end_campaign_session(uuid, boolean, boolean, boolean) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.campaign_sessions;
exception
  when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.campaign_settings;
exception
  when duplicate_object then null;
end;
$$;
