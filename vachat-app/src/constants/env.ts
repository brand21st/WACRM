import { Platform } from 'react-native';

const REQUIRED_PUBLIC_ENV = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_API_URL',
] as const;

export type PublicEnvName = (typeof REQUIRED_PUBLIC_ENV)[number];

export type PublicEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
};

export type PublicEnvResult =
  | { ok: true; env: PublicEnv }
  | { ok: false; missing: PublicEnvName[] };

const DEFAULT_LOCAL_API_URL = 'http://127.0.0.1:3000';

function readPublicVar(name: PublicEnvName): string {
  return process.env[name]?.trim() ?? '';
}

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
  const missing = REQUIRED_PUBLIC_ENV.filter((name) => !readPublicVar(name));
  if (missing.length > 0) {
    return { ok: false, missing };
  }

  const configuredApiUrl = readPublicVar('EXPO_PUBLIC_API_URL');

  return {
    ok: true,
    env: {
      supabaseUrl: readPublicVar('EXPO_PUBLIC_SUPABASE_URL'),
      supabaseAnonKey: readPublicVar('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
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
