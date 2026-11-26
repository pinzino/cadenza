import { createClient } from 'npm:@supabase/supabase-js@2';

function firstConfiguredKey(...names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  return null;
}

function firstKeyFromMap(name: string) {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const values = Object.values(JSON.parse(raw));
    return typeof values[0] === 'string' ? values[0] : null;
  } catch {
    return null;
  }
}

export function getSupabaseUrl() {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL non configurato.');
  return url;
}

export function getPublishableKey() {
  const key = firstConfiguredKey('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY') ?? firstKeyFromMap('SUPABASE_PUBLISHABLE_KEYS');
  if (!key) throw new Error('Chiave pubblica Supabase non configurata.');
  return key;
}

export function getSecretKey() {
  const key = firstConfiguredKey('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY') ?? firstKeyFromMap('SUPABASE_SECRET_KEYS');
  if (!key) throw new Error('Chiave server Supabase non configurata.');
  return key;
}

export function getAdminClient() {
  return createClient(getSupabaseUrl(), getSecretKey(), { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) return null;
  const client = createClient(getSupabaseUrl(), getPublishableKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  return error ? null : data.user;
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
