-- Add the character's own name without changing the player's campaign identity.
-- Run after 202611030006_activity_log.sql.

alter table public.character_sheets
  add column if not exists character_name text not null default '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'character_sheets_character_name_length'
      and conrelid = 'public.character_sheets'::regclass
  ) then
    alter table public.character_sheets
      add constraint character_sheets_character_name_length
      check (char_length(character_name) <= 100);
  end if;
end;
$$;
