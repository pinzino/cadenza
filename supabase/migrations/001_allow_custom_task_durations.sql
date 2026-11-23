-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- Permette durate superiori a una giornata per i task già esistenti.

alter table public.tasks drop constraint if exists tasks_duration_minutes_check;
alter table public.tasks add constraint tasks_duration_minutes_check check (duration_minutes > 0);
