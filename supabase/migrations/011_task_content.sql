alter table public.tasks
  add column if not exists task_type text not null default 'task'
  check (task_type in ('task', 'note', 'checklist')),
  add column if not exists notes text;

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  is_complete boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete
on table public.task_checklist_items
to authenticated;

alter table public.task_checklist_items enable row level security;

drop policy if exists "Users manage their checklist items" on public.task_checklist_items;
create policy "Users manage their checklist items"
  on public.task_checklist_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.prevent_incomplete_checklist_completion()
returns trigger
language plpgsql
as $$
begin
  if new.task_type = 'checklist' and new.is_complete and exists (
    select 1
    from public.task_checklist_items
    where task_id = new.id and not is_complete
  ) then
    raise exception 'Completa prima tutti i punti della checklist.';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_require_completed_checklist on public.tasks;
create trigger tasks_require_completed_checklist
  before update of is_complete, task_type on public.tasks
  for each row execute function public.prevent_incomplete_checklist_completion();
