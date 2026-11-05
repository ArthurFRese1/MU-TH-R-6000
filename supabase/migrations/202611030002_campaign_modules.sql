-- MU/TH/R 6000: persistent campaign modules and private player data.
-- Run after 202611030001_foundation.sql in the Supabase SQL Editor.

create table public.character_sheets (
  member_id uuid primary key references public.campaign_members (id) on delete cascade,
  role text not null default '' check (char_length(role) <= 100),
  function_name text not null default '' check (char_length(function_name) <= 100),
  description text not null default '' check (char_length(description) <= 2000),
  updated_at timestamptz not null default now()
);

create table public.saved_senders (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create unique index saved_senders_campaign_email_idx
  on public.saved_senders (campaign_id, lower(email));

create table public.campaign_emails (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  sender_email text not null check (char_length(sender_email) between 3 and 254),
  sender_name text not null check (char_length(btrim(sender_name)) between 1 and 100),
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  sent_by uuid not null references auth.users (id),
  reply_to_id uuid references public.campaign_emails (id) on delete set null,
  sent_at timestamptz not null default now()
);
create index campaign_emails_campaign_sent_idx
  on public.campaign_emails (campaign_id, sent_at desc);

create table public.campaign_email_recipients (
  email_id uuid not null references public.campaign_emails (id) on delete cascade,
  member_id uuid not null references public.campaign_members (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (email_id, member_id)
);
create index campaign_email_recipients_member_idx
  on public.campaign_email_recipients (member_id, delivered_at desc);

create table public.campaign_folders (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  parent_id uuid references public.campaign_folders (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (campaign_id, parent_id, name)
);

create table public.campaign_files (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  folder_id uuid references public.campaign_folders (id) on delete set null,
  storage_path text not null unique,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  mime_type text not null check (mime_type like 'image/%' or mime_type = 'application/pdf'),
  byte_size bigint not null check (byte_size between 1 and 52428800),
  uploaded_by uuid not null references auth.users (id),
  uploaded_at timestamptz not null default now()
);
create index campaign_files_campaign_uploaded_idx
  on public.campaign_files (campaign_id, uploaded_at desc);

create function public.reject_file_metadata_delete_while_object_exists()
returns trigger
language plpgsql
security definer
set search_path = storage, public, pg_temp
as $$
begin
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'campaign-files' and o.name = old.storage_path
  ) then
    if tg_op = 'DELETE' then
      raise exception 'Remova o objeto do bucket privado antes de apagar seu registro.';
    end if;
    if old.storage_path is distinct from new.storage_path then
      raise exception 'Remova o objeto anterior do bucket antes de substituir o caminho.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_campaign_file_object_on_delete
  before delete on public.campaign_files
  for each row execute function public.reject_file_metadata_delete_while_object_exists();
create trigger protect_campaign_file_path_on_update
  before update of storage_path on public.campaign_files
  for each row execute function public.reject_file_metadata_delete_while_object_exists();

create table public.campaign_email_images (
  email_id uuid not null references public.campaign_emails (id) on delete cascade,
  file_id uuid not null references public.campaign_files (id) on delete cascade,
  primary key (email_id, file_id)
);

create table public.campaign_file_recipients (
  file_id uuid not null references public.campaign_files (id) on delete cascade,
  member_id uuid not null references public.campaign_members (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (file_id, member_id)
);

create table public.campaign_notebooks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (campaign_id, name)
);

create table public.campaign_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  notebook_id uuid references public.campaign_notebooks (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null default '' check (char_length(body) <= 30000),
  visibility text not null default 'private' check (visibility in ('private', 'published')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index campaign_notes_campaign_updated_idx
  on public.campaign_notes (campaign_id, updated_at desc);

create table public.campaign_note_recipients (
  note_id uuid not null references public.campaign_notes (id) on delete cascade,
  member_id uuid not null references public.campaign_members (id) on delete cascade,
  published_at timestamptz not null default now(),
  primary key (note_id, member_id)
);

create table public.player_note_states (
  note_id uuid not null,
  member_id uuid not null,
  read_at timestamptz,
  archived_at timestamptz,
  primary key (note_id, member_id),
  foreign key (note_id, member_id)
    references public.campaign_note_recipients (note_id, member_id) on delete cascade
);

create table public.player_note_annotations (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.campaign_notes (id) on delete cascade,
  member_id uuid not null references public.campaign_members (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 12000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (note_id, member_id)
);

create table public.campaign_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  session_id uuid references public.campaign_sessions (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text not null check (char_length(body) between 1 and 10000),
  event_type text not null check (event_type in ('alert', 'urgent', 'terminal', 'failure', 'incident', 'custom')),
  presentation text not null default 'standard' check (presentation in ('standard', 'emergency', 'quiet')),
  is_temporary boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  check (not is_temporary or session_id is not null)
);
create index campaign_events_campaign_created_idx
  on public.campaign_events (campaign_id, created_at desc);

create table public.campaign_event_recipients (
  event_id uuid not null references public.campaign_events (id) on delete cascade,
  member_id uuid not null references public.campaign_members (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (event_id, member_id)
);

create table public.campaign_bulletins (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.campaigns (id) on delete cascade,
  title text not null default 'Bem-vindo a bordo' check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 10000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.campaign_notifications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  member_id uuid not null references public.campaign_members (id) on delete cascade,
  content_type text not null check (content_type in ('email', 'message', 'note', 'file', 'event', 'bulletin')),
  content_id uuid,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index campaign_notifications_member_created_idx
  on public.campaign_notifications (member_id, created_at desc);

create table public.campaign_activity_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_member_id uuid references public.campaign_members (id) on delete set null,
  activity_type text not null check (char_length(activity_type) between 1 and 80),
  description text not null check (char_length(description) between 1 and 1000),
  is_temporary boolean not null default false,
  session_id uuid references public.campaign_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  check (not is_temporary or session_id is not null)
);
create index campaign_activity_log_campaign_created_idx
  on public.campaign_activity_log (campaign_id, created_at desc);

create table public.player_interface_preferences (
  member_id uuid primary key references public.campaign_members (id) on delete cascade,
  sidebar_position text not null default 'left' check (sidebar_position in ('left', 'right')),
  sidebar_collapsed boolean not null default false,
  information_panel_order text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.player_campaign_states (
  member_id uuid primary key references public.campaign_members (id) on delete cascade,
  welcome_acknowledged_at timestamptz
);

create table public.chat_typing_indicators (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  member_id uuid references public.campaign_members (id) on delete cascade,
  chat_type text not null check (chat_type in ('global', 'local')),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id, chat_type)
);
create index chat_typing_indicators_updated_idx
  on public.chat_typing_indicators (updated_at);

create table public.identity_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  member_id uuid not null references public.campaign_members (id) on delete cascade,
  requested_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id)
);
create index identity_recovery_campaign_idx
  on public.identity_recovery_requests (campaign_id, requested_at desc);
create unique index identity_recovery_pending_idx
  on public.identity_recovery_requests (member_id, requested_user_id)
  where status = 'pending';

create function public.can_read_campaign_email(p_email_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.campaign_emails e
    join public.campaign_email_recipients r on r.email_id = e.id
    join public.campaign_members m on m.id = r.member_id
    where e.id = p_email_id and m.user_id = auth.uid() and not m.is_blocked
  );
$$;

create function public.campaign_folder_belongs_to(p_folder_id uuid, p_campaign_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.campaign_folders f
    where f.id = p_folder_id and f.campaign_id = p_campaign_id
  );
$$;

create function public.can_read_campaign_file(p_file_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.campaign_file_recipients r
    join public.campaign_members m on m.id = r.member_id
    where r.file_id = p_file_id and m.user_id = auth.uid() and not m.is_blocked
  ) or exists (
    select 1
    from public.campaign_email_images i
    join public.campaign_email_recipients r on r.email_id = i.email_id
    join public.campaign_members m on m.id = r.member_id
    where i.file_id = p_file_id and m.user_id = auth.uid() and not m.is_blocked
  );
$$;

create function public.can_read_campaign_note(p_note_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.campaign_note_recipients r
    join public.campaign_members m on m.id = r.member_id
    where r.note_id = p_note_id and m.user_id = auth.uid() and not m.is_blocked
  );
$$;

create function public.can_read_campaign_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.campaign_event_recipients r
    join public.campaign_members m on m.id = r.member_id
    where r.event_id = p_event_id and m.user_id = auth.uid() and not m.is_blocked
  );
$$;

alter table public.character_sheets enable row level security;
alter table public.saved_senders enable row level security;
alter table public.campaign_emails enable row level security;
alter table public.campaign_email_recipients enable row level security;
alter table public.campaign_email_images enable row level security;
alter table public.campaign_folders enable row level security;
alter table public.campaign_files enable row level security;
alter table public.campaign_file_recipients enable row level security;
alter table public.campaign_notebooks enable row level security;
alter table public.campaign_notes enable row level security;
alter table public.campaign_note_recipients enable row level security;
alter table public.player_note_states enable row level security;
alter table public.player_note_annotations enable row level security;
alter table public.campaign_events enable row level security;
alter table public.campaign_event_recipients enable row level security;
alter table public.campaign_bulletins enable row level security;
alter table public.campaign_notifications enable row level security;
alter table public.campaign_activity_log enable row level security;
alter table public.player_interface_preferences enable row level security;
alter table public.player_campaign_states enable row level security;
alter table public.chat_typing_indicators enable row level security;
alter table public.identity_recovery_requests enable row level security;

create policy "Owners can block campaign members"
  on public.campaign_members for update to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (public.is_campaign_owner(campaign_id));
create policy "Owners can remove campaign members"
  on public.campaign_members for delete to authenticated
  using (public.is_campaign_owner(campaign_id));

drop policy "Registered masters can delete their campaigns" on public.campaigns;
create policy "Registered masters can delete campaigns without stored objects"
  on public.campaigns for delete to authenticated
  using (
    owner_id = auth.uid()
    and public.is_registered_master()
    and not exists (
      select 1 from public.campaign_files f
      where f.campaign_id = campaigns.id
    )
  );

create policy "Players and owners can read character sheets"
  on public.character_sheets for select to authenticated
  using (
    exists (
      select 1 from public.campaign_members m
      where m.id = member_id
        and (m.user_id = auth.uid() or public.is_campaign_owner(m.campaign_id))
    )
  );
create policy "Players can create their own character sheet"
  on public.character_sheets for insert to authenticated
  with check (
    exists (
      select 1 from public.campaign_members m
      where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked
    )
  );
create policy "Players can update their own character sheet"
  on public.character_sheets for update to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked))
  with check (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));
create policy "Email images visible to owner and email recipients"
  on public.campaign_email_images for select to authenticated
  using (
    exists (select 1 from public.campaign_emails e where e.id = email_id and (public.is_campaign_owner(e.campaign_id) or public.can_read_campaign_email(e.id)))
  );
create policy "Owners can attach images from their own campaign"
  on public.campaign_email_images for insert to authenticated
  with check (
    exists (
      select 1 from public.campaign_emails e
      join public.campaign_files f on f.id = file_id and f.campaign_id = e.campaign_id
      where e.id = email_id and f.mime_type like 'image/%' and public.is_campaign_owner(e.campaign_id)
    )
  );

create policy "Owners can manage saved senders"
  on public.saved_senders for all to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (public.is_campaign_owner(campaign_id));

create policy "Owners and addressed players can read emails"
  on public.campaign_emails for select to authenticated
  using (public.is_campaign_owner(campaign_id) or public.can_read_campaign_email(id) or sent_by = auth.uid());
create policy "Owners can send campaign emails"
  on public.campaign_emails for insert to authenticated
  with check (public.is_campaign_owner(campaign_id) and sent_by = auth.uid());

create policy "Email recipients visible to owner and each recipient"
  on public.campaign_email_recipients for select to authenticated
  using (
    exists (
      select 1 from public.campaign_emails e
      where e.id = email_id
        and (public.is_campaign_owner(e.campaign_id) or exists (
          select 1 from public.campaign_members m
          where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked
        ))
    )
  );
create policy "Owners can assign email recipients"
  on public.campaign_email_recipients for insert to authenticated
  with check (exists (select 1 from public.campaign_emails e where e.id = email_id and public.is_campaign_owner(e.campaign_id)));
create policy "Players can mark their own email read"
  on public.campaign_email_recipients for update to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked))
  with check (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));

create policy "Owners can manage campaign folders"
  on public.campaign_folders for all to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (
    public.is_campaign_owner(campaign_id)
    and (parent_id is null or public.campaign_folder_belongs_to(parent_id, campaign_id))
  );

create policy "Owners and addressed players can read files"
  on public.campaign_files for select to authenticated
  using (public.is_campaign_owner(campaign_id) or public.can_read_campaign_file(id));
create policy "Owners can register files"
  on public.campaign_files for insert to authenticated
  with check (
    public.is_campaign_owner(campaign_id)
    and uploaded_by = auth.uid()
    and (folder_id is null or exists (
      select 1 from public.campaign_folders f
      where f.id = folder_id and f.campaign_id = campaign_id
    ))
  );
create policy "Owners can replace or remove file metadata"
  on public.campaign_files for update to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (public.is_campaign_owner(campaign_id));
create policy "Owners can remove file metadata"
  on public.campaign_files for delete to authenticated
  using (public.is_campaign_owner(campaign_id));
create policy "File recipients visible to owner and addressed player"
  on public.campaign_file_recipients for select to authenticated
  using (
    exists (
      select 1 from public.campaign_files f
      where f.id = file_id and (
        public.is_campaign_owner(f.campaign_id)
        or exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked)
      )
    )
  );
create policy "Owners can assign file recipients"
  on public.campaign_file_recipients for insert to authenticated
  with check (exists (select 1 from public.campaign_files f where f.id = file_id and public.is_campaign_owner(f.campaign_id)));

create policy "Owners can manage notebooks"
  on public.campaign_notebooks for all to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (public.is_campaign_owner(campaign_id));
create policy "Owners and published recipients can read notes"
  on public.campaign_notes for select to authenticated
  using (
    public.is_campaign_owner(campaign_id)
    or (visibility = 'published' and public.can_read_campaign_note(id))
  );
create policy "Owners can create notes"
  on public.campaign_notes for insert to authenticated
  with check (
    public.is_campaign_owner(campaign_id)
    and created_by = auth.uid()
    and (notebook_id is null or exists (
      select 1 from public.campaign_notebooks n
      where n.id = notebook_id and n.campaign_id = campaign_id
    ))
  );
create policy "Owners can update notes"
  on public.campaign_notes for update to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (public.is_campaign_owner(campaign_id));
create policy "Owners can delete notes"
  on public.campaign_notes for delete to authenticated
  using (public.is_campaign_owner(campaign_id));
create policy "Note recipients visible to owner and self"
  on public.campaign_note_recipients for select to authenticated
  using (
    exists (select 1 from public.campaign_notes n where n.id = note_id and public.is_campaign_owner(n.campaign_id))
    or exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked)
  );
create policy "Owners can publish notes to members"
  on public.campaign_note_recipients for insert to authenticated
  with check (
    exists (
      select 1 from public.campaign_notes n
      join public.campaign_members m on m.id = member_id and m.campaign_id = n.campaign_id and not m.is_blocked
      where n.id = note_id and n.visibility = 'published' and public.is_campaign_owner(n.campaign_id)
    )
  );
create policy "Players can manage their own note state"
  on public.player_note_states for all to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked))
  with check (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));
create policy "Players can privately manage their annotations"
  on public.player_note_annotations for all to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked))
  with check (
    exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked)
    and exists (select 1 from public.campaign_note_recipients r where r.note_id = note_id and r.member_id = member_id)
  );

create policy "Owners and event recipients can read events"
  on public.campaign_events for select to authenticated
  using (public.is_campaign_owner(campaign_id) or public.can_read_campaign_event(id));
create policy "Owners can create events"
  on public.campaign_events for insert to authenticated
  with check (public.is_campaign_owner(campaign_id) and created_by = auth.uid());
create policy "Owners can delete events"
  on public.campaign_events for delete to authenticated
  using (public.is_campaign_owner(campaign_id));
create policy "Event recipients visible to owner and self"
  on public.campaign_event_recipients for select to authenticated
  using (
    exists (select 1 from public.campaign_events e where e.id = event_id and public.is_campaign_owner(e.campaign_id))
    or exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked)
  );
create policy "Owners can assign event recipients"
  on public.campaign_event_recipients for insert to authenticated
  with check (
    exists (
      select 1 from public.campaign_events e
      join public.campaign_members m on m.id = member_id and m.campaign_id = e.campaign_id and not m.is_blocked
      where e.id = event_id and public.is_campaign_owner(e.campaign_id)
    )
  );
create policy "Recipients can mark events read"
  on public.campaign_event_recipients for update to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked))
  with check (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));

create policy "Members can read enabled welcome bulletin"
  on public.campaign_bulletins for select to authenticated
  using (enabled and public.is_campaign_member(campaign_id));
create policy "Owners can manage welcome bulletin"
  on public.campaign_bulletins for all to authenticated
  using (public.is_campaign_owner(campaign_id))
  with check (public.is_campaign_owner(campaign_id));

create policy "Owners and notification recipients can read notifications"
  on public.campaign_notifications for select to authenticated
  using (public.is_campaign_owner(campaign_id) or exists (
    select 1 from public.campaign_members m
    where m.id = member_id and m.campaign_id = campaign_id and m.user_id = auth.uid() and not m.is_blocked
  ));
create policy "Owners can create notifications"
  on public.campaign_notifications for insert to authenticated
  with check (
    public.is_campaign_owner(campaign_id)
    and exists (
      select 1 from public.campaign_members m
      where m.id = member_id and m.campaign_id = campaign_id and not m.is_blocked
    )
  );
create policy "Recipients can mark notifications read"
  on public.campaign_notifications for update to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked))
  with check (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));

create policy "Owners can inspect campaign activity"
  on public.campaign_activity_log for select to authenticated
  using (public.is_campaign_owner(campaign_id));
create policy "Owners can record campaign activity"
  on public.campaign_activity_log for insert to authenticated
  with check (
    public.is_campaign_owner(campaign_id)
    and (actor_user_id is null or actor_user_id = auth.uid())
    and (not is_temporary or exists (
      select 1 from public.campaign_sessions s
      where s.id = session_id and s.campaign_id = campaign_id
    ))
  );
create policy "Owners can clear temporary campaign activity"
  on public.campaign_activity_log for delete to authenticated
  using (public.is_campaign_owner(campaign_id) and is_temporary);

create policy "Players can read their interface preferences"
  on public.player_interface_preferences for select to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));
create policy "Players can manage their interface preferences"
  on public.player_interface_preferences for all to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked))
  with check (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));
create policy "Players can manage their campaign state"
  on public.player_campaign_states for all to authenticated
  using (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked))
  with check (exists (select 1 from public.campaign_members m where m.id = member_id and m.user_id = auth.uid() and not m.is_blocked));

create policy "Players can read global typing indicators"
  on public.chat_typing_indicators for select to authenticated
  using (
    chat_type = 'global'
    and (public.is_campaign_owner(campaign_id) or public.is_campaign_member(campaign_id))
  );
create policy "Players can read local typing indicators"
  on public.chat_typing_indicators for select to authenticated
  using (
    chat_type = 'local'
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and public.is_campaign_member(campaign_id)
  );
create policy "Campaign members can manage global typing indicators"
  on public.chat_typing_indicators for all to authenticated
  using (
    chat_type = 'global'
    and user_id = auth.uid()
    and (
      (member_id is null and public.is_campaign_owner(campaign_id))
      or exists (select 1 from public.campaign_members m where m.id = member_id and m.campaign_id = campaign_id and m.user_id = auth.uid() and not m.is_blocked)
    )
  )
  with check (
    chat_type = 'global'
    and user_id = auth.uid()
    and (
      (member_id is null and public.is_campaign_owner(campaign_id))
      or exists (select 1 from public.campaign_members m where m.id = member_id and m.campaign_id = campaign_id and m.user_id = auth.uid() and not m.is_blocked)
    )
  );
create policy "Only players can manage local typing indicators"
  on public.chat_typing_indicators for all to authenticated
  using (
    chat_type = 'local'
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and user_id = auth.uid()
    and exists (select 1 from public.campaign_members m where m.id = member_id and m.campaign_id = campaign_id and m.user_id = auth.uid() and not m.is_blocked)
  )
  with check (
    chat_type = 'local'
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and user_id = auth.uid()
    and exists (select 1 from public.campaign_members m where m.id = member_id and m.campaign_id = campaign_id and m.user_id = auth.uid() and not m.is_blocked)
  );

create policy "Requesters and campaign owners can read recovery requests"
  on public.identity_recovery_requests for select to authenticated
  using (requested_user_id = auth.uid() or public.is_campaign_owner(campaign_id));
create policy "Anonymous players can request identity recovery"
  on public.identity_recovery_requests for insert to authenticated
  with check (
    requested_user_id = auth.uid()
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    and status = 'pending'
    and exists (
      select 1 from public.campaign_members m
      where m.id = member_id and m.campaign_id = campaign_id and not m.is_blocked
    )
  );
create policy "Campaign owners can resolve recovery requests"
  on public.identity_recovery_requests for update to authenticated
  using (public.is_campaign_owner(campaign_id) and status = 'pending')
  with check (
    public.is_campaign_owner(campaign_id)
    and status in ('approved', 'rejected')
    and resolved_by = auth.uid()
  );

create function public.approve_identity_recovery(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_request public.identity_recovery_requests%rowtype;
  v_member public.campaign_members%rowtype;
begin
  select * into v_request
  from public.identity_recovery_requests
  where id = p_request_id and status = 'pending'
  for update;
  if not found or not public.is_campaign_owner(v_request.campaign_id) or not public.is_registered_master() then
    raise exception 'Solicitação inexistente, resolvida ou fora da sua campanha.';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = v_request.requested_user_id
      and coalesce(u.is_anonymous, false)
  ) then
    raise exception 'A nova identidade deve ser uma sessão anônima de jogador.';
  end if;
  select * into v_member
  from public.campaign_members
  where id = v_request.member_id and campaign_id = v_request.campaign_id and not is_blocked
  for update;
  if not found then
    raise exception 'A participação original não existe ou está bloqueada.';
  end if;
  if exists (
    select 1 from public.campaign_members
    where campaign_id = v_request.campaign_id and user_id = v_request.requested_user_id
  ) then
    raise exception 'A nova identidade já participa desta campanha.';
  end if;
  update public.campaign_members
  set user_id = v_request.requested_user_id
  where id = v_request.member_id;
  update public.identity_recovery_requests
  set status = 'approved', resolved_at = now(), resolved_by = auth.uid()
  where id = p_request_id;
  return v_request.member_id;
end;
$$;

create function public.reject_identity_recovery(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  update public.identity_recovery_requests
  set status = 'rejected', resolved_at = now(), resolved_by = auth.uid()
  where id = p_request_id
    and status = 'pending'
    and public.is_registered_master()
    and public.is_campaign_owner(campaign_id);
  if not found then
    raise exception 'Solicitação inexistente, resolvida ou fora da sua campanha.';
  end if;
end;
$$;

revoke all on function public.can_read_campaign_email(uuid) from public;
revoke all on function public.can_read_campaign_file(uuid) from public;
revoke all on function public.can_read_campaign_note(uuid) from public;
revoke all on function public.can_read_campaign_event(uuid) from public;
revoke all on function public.campaign_folder_belongs_to(uuid, uuid) from public;
revoke all on function public.approve_identity_recovery(uuid) from public;
revoke all on function public.reject_identity_recovery(uuid) from public;
grant execute on function public.can_read_campaign_email(uuid) to authenticated;
grant execute on function public.can_read_campaign_file(uuid) to authenticated;
grant execute on function public.can_read_campaign_note(uuid) to authenticated;
grant execute on function public.can_read_campaign_event(uuid) to authenticated;
grant execute on function public.campaign_folder_belongs_to(uuid, uuid) to authenticated;
grant execute on function public.approve_identity_recovery(uuid) to authenticated;
grant execute on function public.reject_identity_recovery(uuid) to authenticated;

revoke all on public.character_sheets, public.saved_senders, public.campaign_emails,
  public.campaign_email_recipients, public.campaign_folders, public.campaign_files,
  public.campaign_email_images,
  public.campaign_file_recipients, public.campaign_notebooks, public.campaign_notes,
  public.campaign_note_recipients, public.player_note_states, public.player_note_annotations,
  public.campaign_events, public.campaign_event_recipients, public.campaign_bulletins,
  public.campaign_notifications, public.campaign_activity_log, public.player_interface_preferences,
  public.player_campaign_states, public.chat_typing_indicators, public.identity_recovery_requests
from anon, authenticated;

grant select, insert, update on public.character_sheets to authenticated;
grant update (is_blocked), delete on public.campaign_members to authenticated;
grant select, insert, update, delete on public.saved_senders, public.campaign_folders,
  public.campaign_notebooks, public.campaign_notes, public.player_note_states,
  public.player_note_annotations, public.campaign_bulletins,
  public.player_interface_preferences, public.player_campaign_states,
  public.chat_typing_indicators to authenticated;
grant select, update, delete on public.campaign_emails to authenticated;
grant select, insert on public.campaign_email_recipients to authenticated;
grant update (read_at) on public.campaign_email_recipients to authenticated;
grant select, insert, delete on public.campaign_email_images to authenticated;
grant select, insert, delete on public.campaign_files to authenticated;
grant update (file_name, folder_id, storage_path, mime_type, byte_size) on public.campaign_files to authenticated;
grant select, insert, delete on public.campaign_file_recipients to authenticated;
grant select, insert, update, delete on public.campaign_note_recipients to authenticated;
grant select, insert, update, delete on public.campaign_events to authenticated;
grant select, insert on public.campaign_event_recipients to authenticated;
grant update (read_at) on public.campaign_event_recipients to authenticated;
grant select, insert on public.campaign_notifications to authenticated;
grant update (read_at) on public.campaign_notifications to authenticated;
grant select, insert, delete on public.campaign_activity_log to authenticated;
grant select, insert, update on public.identity_recovery_requests to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.campaign_notifications;
exception
  when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.campaign_emails;
exception
  when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.campaign_events;
exception
  when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.campaign_sessions;
exception
  when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.chat_typing_indicators;
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

-- These policies preserve the existing private bucket and its size/type settings.
drop policy if exists "MU/TH/R campaign file read" on storage.objects;
create policy "MU/TH/R campaign file read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'campaign-files'
    and exists (
      select 1 from public.campaign_files f
      where f.storage_path = name
        and (public.is_campaign_owner(f.campaign_id) or public.can_read_campaign_file(f.id))
    )
  );
drop policy if exists "MU/TH/R campaign file upload" on storage.objects;
create policy "MU/TH/R campaign file upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'campaign-files'
    and exists (
      select 1 from public.campaign_files f
      where f.storage_path = name
        and f.uploaded_by = auth.uid()
        and public.is_campaign_owner(f.campaign_id)
    )
  );
drop policy if exists "MU/TH/R campaign file update" on storage.objects;
create policy "MU/TH/R campaign file update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'campaign-files'
    and exists (
      select 1 from public.campaign_files f
      where f.storage_path = name and public.is_campaign_owner(f.campaign_id)
    )
  )
  with check (
    bucket_id = 'campaign-files'
    and exists (
      select 1 from public.campaign_files f
      where f.storage_path = name and public.is_campaign_owner(f.campaign_id)
    )
  );

create policy "MU/TH/R restrict campaign file read"
  on storage.objects as restrictive for select to authenticated
  using (
    bucket_id <> 'campaign-files'
    or exists (
      select 1 from public.campaign_files f
      where f.storage_path = name
        and (public.is_campaign_owner(f.campaign_id) or public.can_read_campaign_file(f.id))
    )
  );
create policy "MU/TH/R restrict campaign file upload"
  on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id <> 'campaign-files'
    or exists (
      select 1 from public.campaign_files f
      where f.storage_path = name
        and f.uploaded_by = auth.uid()
        and public.is_campaign_owner(f.campaign_id)
    )
  );
create policy "MU/TH/R restrict campaign file update"
  on storage.objects as restrictive for update to authenticated
  using (
    bucket_id <> 'campaign-files'
    or exists (
      select 1 from public.campaign_files f
      where f.storage_path = name and public.is_campaign_owner(f.campaign_id)
    )
  )
  with check (
    bucket_id <> 'campaign-files'
    or exists (
      select 1 from public.campaign_files f
      where f.storage_path = name and public.is_campaign_owner(f.campaign_id)
    )
  );
create policy "MU/TH/R restrict campaign file delete"
  on storage.objects as restrictive for delete to authenticated
  using (
    bucket_id <> 'campaign-files'
    or exists (
      select 1 from public.campaign_files f
      where f.storage_path = name and public.is_campaign_owner(f.campaign_id)
    )
  );
create policy "MU/TH/R restrict anonymous campaign file read"
  on storage.objects as restrictive for select to anon
  using (bucket_id <> 'campaign-files');
create policy "MU/TH/R restrict anonymous campaign file upload"
  on storage.objects as restrictive for insert to anon
  with check (bucket_id <> 'campaign-files');
create policy "MU/TH/R restrict anonymous campaign file update"
  on storage.objects as restrictive for update to anon
  using (bucket_id <> 'campaign-files')
  with check (bucket_id <> 'campaign-files');
create policy "MU/TH/R restrict anonymous campaign file delete"
  on storage.objects as restrictive for delete to anon
  using (bucket_id <> 'campaign-files');
drop policy if exists "MU/TH/R campaign file delete" on storage.objects;
create policy "MU/TH/R campaign file delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'campaign-files'
    and exists (
      select 1 from public.campaign_files f
      where f.storage_path = name and public.is_campaign_owner(f.campaign_id)
    )
  );
