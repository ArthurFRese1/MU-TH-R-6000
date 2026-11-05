alter table public.campaign_event_recipients
  add column if not exists dismissed_at timestamptz;

create or replace function public.dismiss_campaign_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Autenticação necessária para fechar este alerta.';
  end if;

  update public.campaign_event_recipients r
  set dismissed_at = coalesce(r.dismissed_at, now())
  from public.campaign_members m
  where r.event_id = p_event_id
    and r.member_id = m.id
    and m.user_id = auth.uid()
    and not m.is_blocked;

  if not found then
    raise exception 'Alerta inexistente ou não destinado a esta participação ativa.';
  end if;
end;
$$;

revoke all on function public.dismiss_campaign_event(uuid) from public;
grant execute on function public.dismiss_campaign_event(uuid) to authenticated;
