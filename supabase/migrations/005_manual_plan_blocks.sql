-- Esegui questo aggiornamento una sola volta nel SQL Editor di Supabase.
-- Distingue gli spostamenti manuali dai blocchi creati automaticamente.

alter table public.task_blocks
  add column if not exists is_manual boolean not null default false;

comment on column public.task_blocks.is_manual is
  'Un blocco spostato manualmente dall''utente: il ricalcolo automatico lo conserva.';
