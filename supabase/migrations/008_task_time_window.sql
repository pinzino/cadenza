-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- Aggiunge una fascia oraria facoltativa entro cui pianificare un task.

alter table public.tasks
  add column if not exists scheduled_window_start time,
  add column if not exists scheduled_window_end time;

alter table public.tasks drop constraint if exists tasks_scheduled_window_check;
alter table public.tasks add constraint tasks_scheduled_window_check check (
  (scheduled_window_start is null and scheduled_window_end is null)
  or (scheduled_window_start is not null and scheduled_window_end is not null and scheduled_window_start < scheduled_window_end)
);

comment on column public.tasks.scheduled_window_start is
  'Inizio facoltativo della fascia in cui il pianificatore può collocare il task.';
comment on column public.tasks.scheduled_window_end is
  'Fine facoltativa della fascia in cui il pianificatore può collocare il task.';
