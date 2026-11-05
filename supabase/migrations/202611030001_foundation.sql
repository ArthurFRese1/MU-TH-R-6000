-- MU/TH/R 6000: identities, campaigns, invite joining, and privacy boundaries.
-- Run in the Supabase SQL Editor as a project administrator.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  is_master boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, is_master)
  values (new.id, new.email_confirmed_at is not null and not coalesce(new.is_anonymous, false))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create function public.handle_auth_user_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles
  set is_master = new.email_confirmed_at is not null
    and not coalesce(new.is_anonymous, false)
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_confirmation_changed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is distinct from new.email_confirmed_at)
  execute function public.handle_auth_user_confirmation();

insert into public.profiles (id, is_master)
select u.id, not coalesce(u.is_anonymous, false)
from auth.users u
on conflict (id) do nothing;

update public.profiles p
set is_master = u.email_confirmed_at is not null
  and not coalesce(u.is_anonymous, false)
from auth.users u
where u.id = p.id;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  cover_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaigns_owner_created_idx on public.campaigns (owner_id, created_at desc);

create table public.campaign_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  code text not null unique check (code ~ '^[A-F0-9]{32}$'),
  is_active boolean not null default true,
  valid_until timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now()
);
create index campaign_invites_campaign_idx on public.campaign_invites (campaign_id, is_active);

create table public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  player_name text not null check (char_length(btrim(player_name)) between 1 and 60),
  fake_email text not null check (fake_email ~* '^[^@[:space:]]+@gmail\.com$'),
  is_blocked boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (campaign_id, user_id)
);
create unique index campaign_members_fake_email_idx
  on public.campaign_members (campaign_id, lower(fake_email));
create index campaign_members_campaign_joined_idx
  on public.campaign_members (campaign_id, joined_at);

create table public.local_chat_aliases (
  member_id uuid primary key references public.campaign_members (id) on delete cascade,
  alias text not null check (char_length(btrim(alias)) between 1 and 40),
  updated_at timestamptz not null default now()
);

create table public.campaign_settings (
  campaign_id uuid primary key references public.campaigns (id) on delete cascade,
  welcome_title text not null default 'Bem-vindo a bordo',
  welcome_message text not null default '',
  welcome_enabled boolean not null default true,
  allow_player_email_replies boolean not null default false,
  show_ship_clock boolean not null default true,
  show_energy boolean not null default true,
  show_oxygen boolean not null default true,
  show_integrity boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.campaign_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  label text not null default 'Sessão',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  timer_started_at timestamptz,
  timer_elapsed_seconds integer not null default 0 check (timer_elapsed_seconds >= 0),
  ship_clock text not null default '',
  energy integer check (energy between 0 and 100),
  oxygen integer check (oxygen between 0 and 100),
  integrity integer check (integrity between 0 and 100),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index campaign_sessions_campaign_started_idx
  on public.campaign_sessions (campaign_id, started_at desc);
create unique index campaign_sessions_one_open_idx
  on public.campaign_sessions (campaign_id) where ended_at is null;

create table public.global_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  session_id uuid references public.campaign_sessions (id) on delete set null,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  author_member_id uuid references public.campaign_members (id) on delete set null,
  author_name text not null default 'Tripulante',
  reply_to_id uuid references public.global_messages (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index global_messages_campaign_created_idx
  on public.global_messages (campaign_id, created_at);

create table public.local_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  session_id uuid references public.campaign_sessions (id) on delete set null,
  author_user_id uuid not null references auth.users (id) on delete cascade,
  author_member_id uuid not null references public.campaign_members (id) on delete cascade,
  author_alias text not null default '',
  reply_to_id uuid references public.local_messages (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index local_messages_campaign_created_idx
  on public.local_messages (campaign_id, created_at);

create function public.is_registered_master()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_master
  );
$$;

create function public.is_campaign_owner(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = p_campaign_id and c.owner_id = auth.uid()
  );
$$;

create function public.is_campaign_member(p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.campaign_members m
    where m.campaign_id = p_campaign_id
      and m.user_id = auth.uid()
      and not m.is_blocked
  );
$$;

create function public.set_global_message_identity()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_member public.campaign_members%rowtype;
begin
  if new.author_user_id <> auth.uid() then
    raise exception 'A mensagem deve pertencer à identidade autenticada.';
  end if;
  if new.session_id is not null and not exists (
    select 1 from public.campaign_sessions s
    where s.id = new.session_id and s.campaign_id = new.campaign_id and s.ended_at is null
  ) then
    raise exception 'A sessão da mensagem não está ativa nesta campanha.';
  end if;
  if new.reply_to_id is not null and not exists (
    select 1 from public.global_messages m
    where m.id = new.reply_to_id and m.campaign_id = new.campaign_id
  ) then
    raise exception 'A resposta deve apontar para uma mensagem desta campanha.';
  end if;
  if public.is_campaign_owner(new.campaign_id) then
    if new.author_member_id is not null then
      raise exception 'Mensagens do mestre não podem usar uma identidade de jogador.';
    end if;
    new.author_name := 'MU/TH/R 6000';
    return new;
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
  new.author_name := v_member.player_name;
  return new;
end;
$$;

create trigger set_global_message_identity_before_insert
  before insert on public.global_messages
  for each row execute function public.set_global_message_identity();

create function public.set_local_message_identity()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_member public.campaign_members%rowtype;
begin
  if new.author_user_id <> auth.uid()
    or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'O chat local aceita apenas a identidade anônima do jogador.';
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
  if new.reply_to_id is not null and not exists (
    select 1 from public.local_messages m
    where m.id = new.reply_to_id and m.campaign_id = new.campaign_id
  ) then
    raise exception 'A resposta deve apontar para uma mensagem desta campanha.';
  end if;
  select a.alias into new.author_alias
  from public.local_chat_aliases a
  where a.member_id = v_member.id;
  if new.author_alias is null or new.author_alias = '' then
    new.author_alias := v_member.player_name;
  end if;
  return new;
end;
$$;

create trigger set_local_message_identity_before_insert
  before insert on public.local_messages
  for each row execute function public.set_local_message_identity();

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_invites enable row level security;
alter table public.campaign_members enable row level security;
alter table public.local_chat_aliases enable row level security;
alter table public.campaign_settings enable row level security;
alter table public.campaign_sessions enable row level security;
alter table public.global_messages enable row level security;
alter table public.local_messages enable row level security;

create policy "Profiles are visible to their account"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "Campaign owners and members can read campaigns"
  on public.campaigns for select to authenticated
  using (owner_id = auth.uid() or public.is_campaign_member(id));
create policy "Registered masters can update their campaigns"
  on public.campaigns for update to authenticated
  using (owner_id = auth.uid() and public.is_registered_master())
  with check (owner_id = auth.uid() and public.is_registered_master());
create policy "Registered masters can delete their campaigns"
  on public.campaigns for delete to authenticated
  using (owner_id = auth.uid() and public.is_registered_master());

create policy "Campaign owners can inspect their invites"
  on public.campaign_invites for select to authenticated
  using (public.is_campaign_owner(campaign_id));

create policy "Owners and active members can inspect memberships"
  on public.campaign_members for select to authenticated
  using (
    public.is_campaign_owner(campaign_id)
    or (user_id = auth.uid() and not is_blocked)
  );
create policy "Players can read their chat alias"
  on public.local_chat_aliases for select to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));
create policy "Players can set their chat alias"
  on public.local_chat_aliases for all to authenticated
  using (
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked)
  )
  with check (
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked)
  );

create policy "Campaign owners and members can read campaign settings"
  on public.campaign_settings for select to authenticated
  using (public.is_campaign_owner(campaign_id) or public.is_campaign_member(campaign_id));
create policy "Campaign owners can update campaign settings"
  on public.campaign_settings for update to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (public.is_campaign_owner(campaign_id));

create policy "Campaign owners and members can read sessions"
  on public.campaign_sessions for select to authenticated
  using (public.is_campaign_owner(campaign_id) or public.is_campaign_member(campaign_id));
create policy "Campaign owners can create sessions"
  on public.campaign_sessions for insert to authenticated
  with check (public.is_campaign_owner(campaign_id) and created_by = auth.uid());
create policy "Campaign owners can update sessions"
  on public.campaign_sessions for update to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (public.is_campaign_owner(campaign_id));
create policy "Campaign owners can delete sessions"
  on public.campaign_sessions for delete to authenticated
  using (public.is_campaign_owner(campaign_id));

create policy "Campaign members and owners can read global messages"
  on public.global_messages for select to authenticated
  using (public.is_campaign_owner(campaign_id) or public.is_campaign_member(campaign_id));
create policy "Campaign members and owners can send global messages"
  on public.global_messages for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and (
      (
        public.is_campaign_owner(campaign_id)
        and author_member_id is null
      )
      or (
        public.is_campaign_member(campaign_id)
        and exists (
        select 1 from public.campaign_members m
        where m.id = author_member_id
          and m.campaign_id = campaign_id
          and m.user_id = auth.uid()
        )
      )
    )
  );
create policy "Authors can edit their own global messages"
  on public.global_messages for update to authenticated
  using (author_user_id = auth.uid() and (public.is_campaign_owner(campaign_id) or public.is_campaign_member(campaign_id)))
  with check (author_user_id = auth.uid() and (public.is_campaign_owner(campaign_id) or public.is_campaign_member(campaign_id)));
create policy "Authors can delete their own global messages"
  on public.global_messages for delete to authenticated
  using (author_user_id = auth.uid() and (public.is_campaign_owner(campaign_id) or public.is_campaign_member(campaign_id)));

-- Intentionally no owner policy: a master cannot read local chat, including via the REST API.
create policy "Only active anonymous members can read local messages"
  on public.local_messages for select to authenticated
  using (
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and public.is_campaign_member(campaign_id)
  );
create policy "Only active anonymous members can send local messages"
  on public.local_messages for insert to authenticated
  with check (
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and author_user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
    and exists (
      select 1 from public.campaign_members m
      where m.id = author_member_id
        and m.campaign_id = campaign_id
        and m.user_id = auth.uid()
        and not m.is_blocked
    )
  );
create policy "Authors can edit their own local messages"
  on public.local_messages for update to authenticated
  using (
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and author_user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
  )
  with check (
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and author_user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
  );
create policy "Authors can delete their own local messages"
  on public.local_messages for delete to authenticated
  using (
    coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and author_user_id = auth.uid()
    and public.is_campaign_member(campaign_id)
  );

create function public.create_campaign(p_name text, p_description text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
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
  v_code := upper(encode(gen_random_bytes(16), 'hex'));
  insert into public.campaign_invites (campaign_id, code)
  values (v_campaign_id, v_code);
  insert into public.campaign_settings (campaign_id) values (v_campaign_id);
  return jsonb_build_object('campaign_id', v_campaign_id, 'invite_code', v_code);
end;
$$;

create function public.rotate_campaign_invite(
  p_campaign_id uuid,
  p_valid_until timestamptz default null,
  p_max_uses integer default null
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
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
  v_code := upper(encode(gen_random_bytes(16), 'hex'));
  insert into public.campaign_invites (campaign_id, code, valid_until, max_uses)
  values (p_campaign_id, v_code, p_valid_until, p_max_uses);
  return v_code;
end;
$$;

create function public.preview_campaign_invite(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'description', c.description,
    'cover_url', c.cover_url
  )
  from public.campaign_invites i
  join public.campaigns c on c.id = i.campaign_id
  where i.code = upper(btrim(coalesce(p_code, '')))
    and i.is_active
    and (i.valid_until is null or i.valid_until > now())
    and (i.max_uses is null or i.uses < i.max_uses)
  limit 1;
$$;

create function public.join_campaign_by_invite(
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
  if auth.uid() is null or not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'A entrada de jogador requer uma sessão anônima.';
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

revoke all on function public.is_registered_master() from public;
revoke all on function public.is_campaign_owner(uuid) from public;
revoke all on function public.is_campaign_member(uuid) from public;
revoke all on function public.set_global_message_identity() from public;
revoke all on function public.set_local_message_identity() from public;
revoke all on function public.create_campaign(text, text) from public;
revoke all on function public.rotate_campaign_invite(uuid, timestamptz, integer) from public;
revoke all on function public.preview_campaign_invite(text) from public;
revoke all on function public.join_campaign_by_invite(text, text, text) from public;
grant execute on function public.is_registered_master() to authenticated;
grant execute on function public.is_campaign_owner(uuid) to authenticated;
grant execute on function public.is_campaign_member(uuid) to authenticated;
grant execute on function public.create_campaign(text, text) to authenticated;
grant execute on function public.rotate_campaign_invite(uuid, timestamptz, integer) to authenticated;
grant execute on function public.preview_campaign_invite(text) to anon, authenticated;
grant execute on function public.join_campaign_by_invite(text, text, text) to authenticated;

revoke all on public.profiles, public.campaigns, public.campaign_invites,
  public.campaign_members, public.local_chat_aliases, public.campaign_settings, public.campaign_sessions,
  public.global_messages, public.local_messages from anon, authenticated;
grant select on public.profiles, public.campaigns, public.campaign_invites,
  public.campaign_members, public.campaign_settings, public.campaign_sessions,
  public.global_messages, public.local_messages to authenticated;
grant select, insert, update, delete on public.local_chat_aliases to authenticated;
grant update on public.campaigns, public.campaign_settings, public.campaign_sessions to authenticated;
grant update (body, edited_at) on public.global_messages to authenticated;
grant update (body, edited_at) on public.local_messages to authenticated;
grant delete on public.campaigns, public.campaign_sessions,
  public.global_messages, public.local_messages to authenticated;
grant insert on public.campaign_sessions, public.global_messages, public.local_messages to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.global_messages;
exception
  when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.local_messages;
exception
  when duplicate_object then null;
end;
$$;
