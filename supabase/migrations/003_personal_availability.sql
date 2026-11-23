-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- day_start/day_end restano la disponibilità di lavoro.

alter table public.planner_settings
  add column if not exists personal_start time not null default '18:00',
  add column if not exists personal_end time not null default '21:00';

alter table public.planner_settings
  drop constraint if exists planner_settings_personal_hours_check;

alter table public.planner_settings
  add constraint planner_settings_personal_hours_check check (personal_start < personal_end);
