-- Collegamento in sola lettura ai calendari Google dell'utente.
-- I token OAuth restano in una tabella non accessibile dall'app mobile.

create table if not exists public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  google_email text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendar_tokens (
  connection_id uuid primary key references public.google_calendar_connections(id) on delete cascade,
  refresh_token text not null,
  scope text,
  updated_at timestamptz not null default now()
);

create table if not exists public.google_calendars (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.google_calendar_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  external_calendar_id text not null,
  title text not null,
  color text,
  is_primary boolean not null default false,
  is_enabled boolean not null default false,
  sync_token text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_calendar_id)
);

create table if not exists public.google_calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.google_calendars(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  external_event_id text not null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_all_day boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (calendar_id, external_event_id),
  check (starts_at < ends_at)
);

-- Stato monouso per difendere il ritorno OAuth da richieste contraffatte.
create table if not exists public.google_oauth_states (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

grant select on table public.google_calendar_connections to authenticated;
grant select, update on table public.google_calendars to authenticated;
grant select on table public.google_calendar_events to authenticated;

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_tokens enable row level security;
alter table public.google_calendars enable row level security;
alter table public.google_calendar_events enable row level security;
alter table public.google_oauth_states enable row level security;

drop policy if exists "Users read their Google connections" on public.google_calendar_connections;
create policy "Users read their Google connections"
  on public.google_calendar_connections for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users read their Google calendars" on public.google_calendars;
create policy "Users read their Google calendars"
  on public.google_calendars for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users choose enabled Google calendars" on public.google_calendars;
create policy "Users choose enabled Google calendars"
  on public.google_calendars for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users read their Google events" on public.google_calendar_events;
create policy "Users read their Google events"
  on public.google_calendar_events for select to authenticated
  using (auth.uid() = user_id);

create index if not exists google_calendars_user_enabled_idx
  on public.google_calendars (user_id, is_enabled);
create index if not exists google_calendar_events_user_starts_idx
  on public.google_calendar_events (user_id, starts_at);
