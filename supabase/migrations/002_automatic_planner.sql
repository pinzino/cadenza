-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- Aggiunge impostazioni personali e blocchi generati dal pianificatore automatico.

create table if not exists public.planner_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  day_start time not null default '09:00',
  day_end time not null default '18:00',
  max_block_minutes integer not null default 60 check (max_block_minutes between 15 and 240),
  break_minutes integer not null default 15 check (break_minutes between 0 and 120),
  updated_at timestamptz not null default now(),
  check (day_start < day_end)
);

create table if not exists public.task_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  block_date date not null,
  start_time time not null,
  end_time time not null,
  duration_minutes integer not null check (duration_minutes > 0),
  block_index integer not null default 1,
  total_blocks integer not null default 1,
  is_fixed boolean not null default false,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

grant select, insert, update, delete on table public.planner_settings to authenticated;
grant select, insert, update, delete on table public.task_blocks to authenticated;

alter table public.planner_settings enable row level security;
alter table public.task_blocks enable row level security;

create policy "Users can read their planner settings"
on public.planner_settings for select to authenticated using (auth.uid() = user_id);
create policy "Users can create their planner settings"
on public.planner_settings for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their planner settings"
on public.planner_settings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can read their task blocks"
on public.task_blocks for select to authenticated using (auth.uid() = user_id);
create policy "Users can create their task blocks"
on public.task_blocks for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their task blocks"
on public.task_blocks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their task blocks"
on public.task_blocks for delete to authenticated using (auth.uid() = user_id);

create index if not exists task_blocks_user_date_idx on public.task_blocks (user_id, block_date, start_time);
create index if not exists task_blocks_task_idx on public.task_blocks (task_id);
