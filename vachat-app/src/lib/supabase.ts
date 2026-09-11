import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getPublicEnv } from '@/constants/env';
import { secureStoreAdapter } from '@/lib/secure-store';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;

  const env = getPublicEnv();
  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: secureStoreAdapter,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
  return client;
}
