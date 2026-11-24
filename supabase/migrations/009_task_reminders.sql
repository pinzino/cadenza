-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- Aggiunge preferenze di promemoria per ogni task e i valori predefiniti.

alter table public.tasks
  add column if not exists reminder_enabled boolean not null default true,
  add column if not exists reminder_minutes integer not null default 10 check (reminder_minutes between 0 and 1440);

alter table public.planner_settings
  add column if not exists reminder_default_enabled boolean not null default true,
  add column if not exists reminder_default_minutes integer not null default 10 check (reminder_default_minutes between 0 and 1440);
