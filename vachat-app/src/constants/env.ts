import { Platform } from 'react-native';

export type PublicEnvName =
  | 'EXPO_PUBLIC_SUPABASE_URL'
  | 'EXPO_PUBLIC_SUPABASE_ANON_KEY'
  | 'EXPO_PUBLIC_API_URL';

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
};

export type PublicEnvResult =
  | { ok: true; env: PublicEnv }
  | { ok: false; missing: PublicEnvName[] };

const DEFAULT_LOCAL_API_URL = 'http://127.0.0.1:3000';
const DEFAULT_SUPABASE_URL = 'https://ijfgwiewyniwrqbbqmbz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmd3aWV3eW5pd3JxYmJxbWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxOTMzMDIsImV4cCI6MjEwMzc2OTMwMn0.p9piF5iZBJIEucnNMKAzeZXDJHLP4obTJZ-8HrxcP2w';
const DEFAULT_API_URL = 'https://cloud.vachat.in';

function isLocalWebDevHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** Expo web on localhost cannot POST cross-origin to cloud.vachat.in (CORS). */
export function resolveApiUrl(configuredApiUrl: string): string {
  const configured = configuredApiUrl.replace(/\/$/, '');
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return configured;
  }

  if (!isLocalWebDevHost(window.location.hostname)) {
    return configured;
  }

  const explicitLocal = process.env.EXPO_PUBLIC_LOCAL_API_URL?.trim();
  if (explicitLocal) {
    return explicitLocal.replace(/\/$/, '');
  }

  try {
    const configuredHost = new URL(configured).hostname;
    if (configuredHost !== window.location.hostname) {
      return DEFAULT_LOCAL_API_URL;
    }
  } catch {
    return configured;
  }

  return configured;
}

export function readPublicEnv(): PublicEnvResult {
  // Metro statically inlines process.env.EXPO_PUBLIC_* when using direct dot-notation.
  // Dynamic process.env[name] access fails on native release bundles.
  const supabaseUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || DEFAULT_SUPABASE_ANON_KEY;
  const configuredApiUrl =
    process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_URL;

  const missing: PublicEnvName[] = [];
  if (!supabaseUrl) missing.push('EXPO_PUBLIC_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  if (!configuredApiUrl) missing.push('EXPO_PUBLIC_API_URL');

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    env: {
      supabaseUrl,
      supabaseAnonKey,
      apiUrl: resolveApiUrl(configuredApiUrl),
    },
  };
}

export function getPublicEnv(): PublicEnv {
  const result = readPublicEnv();
  if (!result.ok) {
    throw new Error(
      `Missing required environment variables: ${result.missing.join(', ')}. Copy .env.example to .env and fill in the public values.`,
    );
  }
  return result.env;
}
