-- Le Edge Function usano service_role per gestire OAuth e sincronizzazione.
-- Token e stati OAuth restano inaccessibili direttamente all'app mobile.

grant usage on schema public to service_role;

grant select, insert, update, delete on table public.google_calendar_connections to service_role;
grant select, insert, update, delete on table public.google_calendar_tokens to service_role;
grant select, insert, update, delete on table public.google_calendars to service_role;
grant select, insert, update, delete on table public.google_calendar_events to service_role;
grant select, insert, update, delete on table public.google_oauth_states to service_role;

revoke all on table public.google_calendar_tokens from anon, authenticated;
revoke all on table public.google_oauth_states from anon, authenticated;
