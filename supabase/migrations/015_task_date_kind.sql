-- Sceglie se scheduled_date indica il giorno preciso o il termine ultimo.
alter table public.tasks
  add column if not exists scheduled_date_kind text not null default 'deadline'
  check (scheduled_date_kind in ('exact', 'deadline'));

-- I task con orario esplicito sono sempre fissati al giorno scelto.
update public.tasks
set scheduled_date_kind = 'exact'
where scheduled_date is not null
  and (scheduled_time is not null or recurrence_rule <> 'none');
