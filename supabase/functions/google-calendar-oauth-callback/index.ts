import { getAdminClient, getSupabaseUrl } from '../_shared/supabase.ts';

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Errore sconosciuto.';
  }
}

function appRedirect(status: 'connected' | 'error', detail?: string, redirectUrl?: string | null) {
  if (redirectUrl) {
    const target = new URL(redirectUrl);
    target.searchParams.set('google_calendar', status);
    return Response.redirect(target.toString(), 302);
  }
  if (status === 'error') {
    const message = detail ? `Collegamento Google non riuscito. Dettaglio: ${detail}` : 'Collegamento Google non riuscito. Torna a Cadenza e riprova.';
    return new Response(message, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return Response.redirect('cadenza:///settings?google_calendar=connected', 302);
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!state) return appRedirect('error');

  let redirectUrl: string | null = null;
  try {
    const admin = getAdminClient();
    const { data: oauthState, error: stateError } = await admin.from('google_oauth_states').select('id, user_id, expires_at, redirect_url').eq('id', state).maybeSingle();
    if (stateError) return appRedirect('error', stateError.message);
    if (!oauthState) return appRedirect('error', 'Richiesta OAuth non trovata o già utilizzata.');
    redirectUrl = oauthState.redirect_url;
    if (!code || url.searchParams.has('error')) return appRedirect('error', 'Autorizzazione Google annullata.', redirectUrl);
    if (new Date(oauthState.expires_at) < new Date()) return appRedirect('error', 'La richiesta OAuth è scaduta.', redirectUrl);

    const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
    if (!clientId || !clientSecret) return appRedirect('error', 'Credenziali Google mancanti su Supabase.', redirectUrl);

    const callback = `${getSupabaseUrl()}/functions/v1/google-calendar-oauth-callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: callback, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
    if (!tokenResponse.ok) throw new Error(tokens.error_description ?? tokens.error ?? 'Google ha rifiutato lo scambio del codice OAuth.');
    if (!tokens.refresh_token) throw new Error('Google non ha restituito un refresh token. Rimuovi l’accesso a Cadenza dal tuo account Google e riprova.');
    if (!tokens.access_token) throw new Error('Google non ha restituito un access token.');

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = profileResponse.ok ? await profileResponse.json() : {};
    const { data: connection, error: connectionError } = await admin
      .from('google_calendar_connections')
      .upsert({ user_id: oauthState.user_id, google_email: typeof profile.email === 'string' ? profile.email : null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select('id')
      .single();
    if (connectionError || !connection) throw connectionError ?? new Error('Connessione Google non salvata.');

    const { error: tokenError } = await admin.from('google_calendar_tokens').upsert({ connection_id: connection.id, refresh_token: tokens.refresh_token, scope: tokens.scope ?? null, updated_at: new Date().toISOString() }, { onConflict: 'connection_id' });
    if (tokenError) throw tokenError;
    await admin.from('google_oauth_states').delete().eq('id', state);
    return appRedirect('connected', undefined, redirectUrl);
  } catch (error) {
    console.error(error);
    return appRedirect('error', errorMessage(error), redirectUrl);
  }
});
