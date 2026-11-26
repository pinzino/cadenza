import { corsHeaders, getAdminClient, getAuthenticatedUser } from '../_shared/supabase.ts';

type GoogleCalendar = { id: string; summary?: string; backgroundColor?: string; primary?: boolean };
type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Collegamento Google non configurato.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('Il collegamento Google Ã¨ scaduto. Ricollega il tuo account.');
  return data.access_token as string;
}

async function googleGet<T>(path: string, accessToken: string) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error?.message === 'string' ? data.error.message : 'Google Calendar non risponde.');
  return data as T;
}

function toIso(value: { dateTime?: string; date?: string } | undefined) {
  if (value?.dateTime) return new Date(value.dateTime).toISOString();
  if (value?.date) return new Date(`${value.date}T00:00:00.000Z`).toISOString();
  return null;
}

async function listAllCalendars(accessToken: string) {
  const calendars: GoogleCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ maxResults: '250' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await googleGet<{ items?: GoogleCalendar[]; nextPageToken?: string }>(`users/me/calendarList?${query}`, accessToken);
    calendars.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return calendars;
}

async function syncCalendarEvents(
  admin: ReturnType<typeof getAdminClient>,
  calendar: { id: string; external_calendar_id: string; user_id: string },
  accessToken: string,
) {
  let pageToken: string | undefined;
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 14 * 86400000).toISOString();
  const syncedAt = now.toISOString();
  const rows: Record<string, unknown>[] = [];

  do {
    const query = new URLSearchParams({ singleEvents: 'true', showDeleted: 'false', maxResults: '250', timeMin, timeMax });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await googleGet<{ items?: GoogleEvent[]; nextPageToken?: string }>(`calendars/${encodeURIComponent(calendar.external_calendar_id)}/events?${query}`, accessToken);
    for (const event of page.items ?? []) {
      const startsAt = toIso(event.start);
      const endsAt = toIso(event.end);
      if (!startsAt || !endsAt || new Date(startsAt) >= new Date(endsAt)) continue;
      rows.push({
        calendar_id: calendar.id,
        user_id: calendar.user_id,
        external_event_id: event.id,
        title: event.summary?.trim() || 'Impegno Google Calendar',
        starts_at: startsAt,
        ends_at: endsAt,
        is_all_day: Boolean(event.start?.date),
        updated_at: syncedAt,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await admin.from('google_calendar_events').upsert(rows.slice(index, index + 100), { onConflict: 'calendar_id,external_event_id' });
    if (error) throw error;
  }
  const { error: staleError } = await admin.from('google_calendar_events').delete().eq('calendar_id', calendar.id).lt('updated_at', syncedAt);
  if (staleError) throw staleError;
  const { error: calendarError } = await admin.from('google_calendars').update({ sync_token: null, last_synced_at: syncedAt, updated_at: syncedAt }).eq('id', calendar.id);
  if (calendarError) throw calendarError;
  return rows.length;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Metodo non supportato.' }, 405);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return json({ error: 'Sessione non valida.' }, 401);
    const admin = getAdminClient();
    const { data: connection, error: connectionError } = await admin.from('google_calendar_connections').select('id').eq('user_id', user.id).maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return json({ error: 'Nessun account Google collegato.' }, 404);

    const { data: token, error: tokenError } = await admin.from('google_calendar_tokens').select('refresh_token').eq('connection_id', connection.id).maybeSingle();
    if (tokenError || !token) return json({ error: 'Collegamento Google non disponibile.' }, 404);
    const accessToken = await refreshAccessToken(token.refresh_token);

    const remoteCalendars = await listAllCalendars(accessToken);
    if (remoteCalendars.length) {
      const { error: calendarError } = await admin.from('google_calendars').upsert(remoteCalendars.map((calendar) => ({
        connection_id: connection.id,
        user_id: user.id,
        external_calendar_id: calendar.id,
        title: calendar.summary?.trim() || 'Calendario senza nome',
        color: calendar.backgroundColor ?? null,
        is_primary: Boolean(calendar.primary),
        updated_at: new Date().toISOString(),
      })), { onConflict: 'connection_id,external_calendar_id' });
      if (calendarError) throw calendarError;
    }

    const { data: enabledCalendars, error: enabledError } = await admin.from('google_calendars').select('id, external_calendar_id, user_id').eq('connection_id', connection.id).eq('is_enabled', true);
    if (enabledError) throw enabledError;
    let changedEvents = 0;
    for (const calendar of enabledCalendars ?? []) changedEvents += await syncCalendarEvents(admin, calendar, accessToken);
    return json({ calendars_found: remoteCalendars.length, calendars_synced: enabledCalendars?.length ?? 0, changed_events: changedEvents });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'Sincronizzazione Google non riuscita.';
    return json({ error: message }, 500);
  }
});
