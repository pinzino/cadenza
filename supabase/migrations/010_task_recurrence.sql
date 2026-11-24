alter table public.tasks
  add column if not exists recurrence_rule text not null default 'none'
  check (recurrence_rule in ('none', 'weekly', 'biweekly', 'monthly'));
