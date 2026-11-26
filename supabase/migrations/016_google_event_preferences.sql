-- Le preferenze locali rimangono sull'evento durante i normali aggiornamenti Google.
alter table public.google_calendar_events
  add column if not exists blocks_time boolean not null default false,
  add column if not exists is_complete boolean not null default false;

-- L'app può cambiare soltanto queste due preferenze, non i dati importati.
grant update (blocks_time, is_complete) on table public.google_calendar_events to authenticated;

drop policy if exists "Users update their Google event preferences" on public.google_calendar_events;
create policy "Users update their Google event preferences"
  on public.google_calendar_events for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
