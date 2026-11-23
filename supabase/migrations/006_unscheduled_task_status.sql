-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- Memorizza quali task non hanno trovato spazio nell'ultimo ricalcolo.

alter table public.tasks
  add column if not exists is_unscheduled boolean not null default false,
  add column if not exists planning_note text;

comment on column public.tasks.is_unscheduled is
  'True quando il pianificatore non trova spazio nei prossimi 90 giorni.';

comment on column public.tasks.planning_note is
  'Breve spiegazione mostrata nella sezione Da sistemare.';
