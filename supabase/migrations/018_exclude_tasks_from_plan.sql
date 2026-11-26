-- I task esclusi restano in Pianifica e non sono collocati dal pianificatore.
alter table public.tasks
  add column if not exists exclude_from_plan boolean not null default false;

comment on column public.tasks.exclude_from_plan is
  'Se true, il task non viene inserito nell’Agenda dai calcoli automatici.';
