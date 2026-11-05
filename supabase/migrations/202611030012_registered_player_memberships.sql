create or replace function public.join_campaign_by_invite(
  p_code text,
  p_player_name text,
  p_fake_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_campaign_id uuid;
  v_membership_id uuid;
  v_name text := btrim(coalesce(p_player_name, ''));
  v_email text := lower(btrim(coalesce(p_fake_email, '')));
begin
  if auth.uid() is null
    or (
      not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
      and not public.is_registered_master()
    ) then
    raise exception 'Entre com uma conta de mestre confirmada ou uma identidade de jogador para aceitar o convite.';
  end if;
  if char_length(v_name) not between 1 and 60 then
    raise exception 'O nome deve conter entre 1 e 60 caracteres.';
  end if;
  if v_email !~* '^[^@[:space:]]+@gmail\.com$' then
    raise exception 'Informe um endereço fictício terminado em @gmail.com.';
  end if;

  update public.campaign_invites i
  set uses = i.uses + 1
  where i.code = upper(btrim(coalesce(p_code, '')))
    and i.is_active
    and (i.valid_until is null or i.valid_until > now())
    and (i.max_uses is null or i.uses < i.max_uses)
  returning i.campaign_id into v_campaign_id;
  if v_campaign_id is null then
    raise exception 'Convite inválido, expirado ou sem utilizações disponíveis.';
  end if;
  if public.is_campaign_owner(v_campaign_id) then
    raise exception 'O proprietário não pode entrar como jogador na própria campanha.';
  end if;
  if exists (
    select 1 from public.campaign_members m
    where m.campaign_id = v_campaign_id and m.user_id = auth.uid()
  ) then
    raise exception 'Esta identidade já está vinculada à campanha.';
  end if;
  if exists (
    select 1 from public.campaign_members m
    where m.campaign_id = v_campaign_id and lower(m.fake_email) = v_email
  ) then
    raise exception 'Este e-mail fictício já está em uso nesta campanha.';
  end if;

  insert into public.campaign_members (campaign_id, user_id, player_name, fake_email)
  values (v_campaign_id, auth.uid(), v_name, v_email)
  returning id into v_membership_id;
  return v_membership_id;
end;
$$;

revoke all on function public.join_campaign_by_invite(text, text, text) from public;
grant execute on function public.join_campaign_by_invite(text, text, text) to authenticated;

create or replace function public.set_local_message_identity()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_member public.campaign_members%rowtype;
begin
  if new.author_user_id <> auth.uid()
    or public.is_campaign_owner(new.campaign_id) then
    raise exception 'O chat local exige uma participação de jogador ativa, não a identidade de proprietário.';
  end if;
  select * into v_member
  from public.campaign_members m
  where m.id = new.author_member_id
    and m.campaign_id = new.campaign_id
    and m.user_id = auth.uid()
    and not m.is_blocked;
  if not found then
    raise exception 'Participação de jogador inválida para esta campanha.';
  end if;
  if new.session_id is not null and not exists (
    select 1 from public.campaign_sessions s
    where s.id = new.session_id and s.campaign_id = new.campaign_id and s.ended_at is null
  ) then
    raise exception 'A sessão da mensagem não está ativa nesta campanha.';
  end if;
  new.author_alias := coalesce((
    select a.alias from public.local_chat_aliases a where a.member_id = v_member.id
  ), v_member.player_name);
  return new;
end;
$$;

drop policy "Players can set their chat alias" on public.local_chat_aliases;
create policy "Active players can set their chat alias"
  on public.local_chat_aliases for all to authenticated
  using (
    not public.is_campaign_owner((
      select m.campaign_id from public.campaign_members m
      where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked
    ))
    and exists (
      select 1 from public.campaign_members m
      where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked
    )
  )
  with check (
    not public.is_campaign_owner((
      select m.campaign_id from public.campaign_members m
      where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked
    ))
    and exists (
      select 1 from public.campaign_members m
      where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked
    )
  );

drop policy "Players can read their chat alias" on public.local_chat_aliases;
create policy "Active players can read their chat alias"
  on public.local_chat_aliases for select to authenticated
  using (exists (
    select 1 from public.campaign_members m
    where m.id = member_id
      and m.user_id = auth.uid()
      and not m.is_blocked
      and not public.is_campaign_owner(m.campaign_id)
  ));

drop policy "Only active anonymous members can read local messages" on public.local_messages;
create policy "Active players can read local messages"
  on public.local_messages for select to authenticated
  using (public.is_campaign_member(campaign_id) and not public.is_campaign_owner(campaign_id));

drop policy "Only active anonymous members can send local messages" on public.local_messages;
create policy "Active players can send local messages"
  on public.local_messages for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
    and not public.is_campaign_owner(campaign_id)
    and exists (
      select 1 from public.campaign_members m
      where m.id = author_member_id
        and m.campaign_id = campaign_id
        and m.user_id = auth.uid()
        and not m.is_blocked
    )
  );

drop policy "Authors can edit their own local messages" on public.local_messages;
create policy "Active players can edit their own local messages"
  on public.local_messages for update to authenticated
  using (
    author_user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
    and not public.is_campaign_owner(campaign_id)
  )
  with check (
    author_user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
    and not public.is_campaign_owner(campaign_id)
  );

drop policy "Authors can delete their own local messages" on public.local_messages;
create policy "Active players can delete their own local messages"
  on public.local_messages for delete to authenticated
  using (
    author_user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
    and not public.is_campaign_owner(campaign_id)
  );

drop policy "Players can read local typing indicators" on public.chat_typing_indicators;
create policy "Active players can read local typing indicators"
  on public.chat_typing_indicators for select to authenticated
  using (
    chat_type = 'local'
    and public.is_campaign_member(campaign_id)
    and not public.is_campaign_owner(campaign_id)
  );

drop policy "Only players can manage local typing indicators" on public.chat_typing_indicators;
create policy "Active players can manage local typing indicators"
  on public.chat_typing_indicators for all to authenticated
  using (
    chat_type = 'local'
    and user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
    and not public.is_campaign_owner(campaign_id)
    and exists (
      select 1 from public.campaign_members m
      where m.id = member_id
        and m.campaign_id = campaign_id
        and m.user_id = auth.uid()
        and not m.is_blocked
    )
  )
  with check (
    chat_type = 'local'
    and user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
    and not public.is_campaign_owner(campaign_id)
    and exists (
      select 1 from public.campaign_members m
      where m.id = member_id
        and m.campaign_id = campaign_id
        and m.user_id = auth.uid()
        and not m.is_blocked
    )
  );

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
  if p_body is null or char_length(btrim(p_body)) not between 1 and 20000 then
    raise exception 'Resposta inválida.';
  end if;

  select * into v_original from public.campaign_emails where id = p_email_id;
  if not found or not public.can_read_campaign_email(p_email_id)
    or public.is_campaign_owner(v_original.campaign_id) then
    raise exception 'E-mail não encontrado ou sem permissão para responder.';
  end if;
  if not exists (
    select 1 from public.campaign_settings s
    where s.campaign_id = v_original.campaign_id and s.allow_player_email_replies
  ) then
    raise exception 'O mestre não habilitou respostas a e-mails.';
  end if;
  select * into v_member from public.campaign_members
  where campaign_id = v_original.campaign_id
    and user_id = auth.uid()
    and not is_blocked;
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

revoke all on function public.reply_to_campaign_email(uuid, text) from public;
grant execute on function public.reply_to_campaign_email(uuid, text) to authenticated;
