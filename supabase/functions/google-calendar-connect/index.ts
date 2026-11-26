import { corsHeaders, getAdminClient, getAuthenticatedUser, getSupabaseUrl } from '../_shared/supabase.ts';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Non riesco ad avviare il collegamento Google.';
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Metodo non supportato.' }, 405);

  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return json({ error: 'Sessione non valida.' }, 401);

    const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
    if (!clientId) return json({ error: 'Collegamento Google non ancora configurato.' }, 503);

    const admin = getAdminClient();
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await admin.from('google_oauth_states').delete().eq('user_id', user.id);
    const { error } = await admin.from('google_oauth_states').insert({ id: state, user_id: user.id, expires_at: expiresAt });
    if (error) throw error;

    const callback = `${getSupabaseUrl()}/functions/v1/google-calendar-oauth-callback`;
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
      scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.readonly',
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}` });
  } catch (error) {
    console.error(error);
    return json({ error: errorMessage(error) }, 500);
  }
});
