-- Restore campaign emails without granting clients direct insert access.
-- Run after 202611030009_campaign_invite_controls.sql.
create or replace function public.restore_campaign_email(
  p_campaign_id uuid,
  p_email_id uuid,
  p_sender_email text,
  p_sender_name text,
  p_subject text,
  p_body text,
  p_reply_to_id uuid,
  p_sent_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_registered_master() or not public.is_campaign_owner(p_campaign_id) then
    raise exception 'Somente o mestre proprietário pode restaurar e-mails nesta campanha.';
  end if;
  if p_email_id is null
    or p_sender_email is null or char_length(p_sender_email) not between 3 and 254
    or p_sender_name is null or char_length(btrim(p_sender_name)) not between 1 and 100
    or p_subject is null or char_length(btrim(p_subject)) not between 1 and 200
    or p_body is null or char_length(p_body) not between 1 and 20000
    or p_sent_at is null then
    raise exception 'Os dados do e-mail restaurado são inválidos.';
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.campaign_emails e
    where e.id = p_reply_to_id and e.campaign_id = p_campaign_id
  ) then
    raise exception 'A resposta do e-mail deve apontar para uma mensagem da mesma campanha.';
  end if;

  insert into public.campaign_emails (
    id, campaign_id, sender_email, sender_name, subject, body, sent_by, reply_to_id, sent_at
  ) values (
    p_email_id, p_campaign_id, lower(btrim(p_sender_email)), btrim(p_sender_name),
    btrim(p_subject), p_body, auth.uid(), p_reply_to_id, p_sent_at
  );
  return p_email_id;
end;
$$;

revoke all on function public.restore_campaign_email(uuid, uuid, text, text, text, text, uuid, timestamptz)
  from public, anon;
grant execute on function public.restore_campaign_email(uuid, uuid, text, text, text, text, uuid, timestamptz)
  to authenticated;
