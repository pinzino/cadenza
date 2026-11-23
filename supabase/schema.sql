-- Esegui questo file una sola volta nel SQL Editor del progetto Supabase Cadenza.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  category text not null default 'Personale' check (category in ('Lavoro', 'Personale')),
  priority text not null default 'Media' check (priority in ('Alta', 'Media', 'Bassa')),
  duration_minutes integer not null default 30 check (duration_minutes > 0),
  scheduled_date date,
  scheduled_time time,
  is_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- L'accesso tramite Data API viene concesso in modo esplicito.
grant select, insert, update, delete on table public.tasks to authenticated;

alter table public.tasks enable row level security;

create policy "Users can read their own tasks"
on public.tasks for select to authenticated
using (auth.uid() = user_id);

create policy "Users can create their own tasks"
on public.tasks for insert to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own tasks"
on public.tasks for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can delete their own tasks"
on public.tasks for delete to authenticated
using (auth.uid() = user_id);

create index if not exists tasks_user_created_at_idx on public.tasks (user_id, created_at desc);

-- Per un nuovo progetto, esegui successivamente anche i file in supabase/migrations.
