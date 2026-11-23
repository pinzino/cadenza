-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- Converte le disponibilità singole in elenchi di fasce orarie.

alter table public.planner_settings
  add column if not exists work_windows jsonb not null default '[]'::jsonb,
  add column if not exists personal_windows jsonb not null default '[]'::jsonb;

update public.planner_settings
set work_windows = jsonb_build_array(
  jsonb_build_object('start', to_char(day_start, 'HH24:MI'), 'end', to_char(day_end, 'HH24:MI'))
)
where work_windows = '[]'::jsonb;

update public.planner_settings
set personal_windows = jsonb_build_array(
  jsonb_build_object('start', to_char(personal_start, 'HH24:MI'), 'end', to_char(personal_end, 'HH24:MI'))
)
where personal_windows = '[]'::jsonb;

alter table public.planner_settings
  drop constraint if exists planner_settings_work_windows_array_check,
  drop constraint if exists planner_settings_personal_windows_array_check;

alter table public.planner_settings
  add constraint planner_settings_work_windows_array_check check (jsonb_typeof(work_windows) = 'array'),
  add constraint planner_settings_personal_windows_array_check check (jsonb_typeof(personal_windows) = 'array');
