-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- Indica se un task può essere distribuito in più blocchi del piano.

alter table public.tasks
  add column if not exists is_splittable boolean not null default true;

comment on column public.tasks.is_splittable is
  'False: il pianificatore deve trovare un unico spazio contiguo per il task.';
