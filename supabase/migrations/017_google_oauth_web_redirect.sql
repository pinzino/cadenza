-- Conserva la pagina web a cui tornare dopo il consenso Google.
alter table public.google_oauth_states
  add column if not exists redirect_url text;
