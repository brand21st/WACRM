export function oauthRedirectTo(input: {
  os: string | undefined;
  webOrigin?: string;
  nativeRedirectUrl: string;
}): string {
  if (input.os === 'web' && input.webOrigin) {
    return `${input.webOrigin.replace(/\/$/, '')}/auth/callback`;
  }
  return input.nativeRedirectUrl;
}

export function passwordResetRedirectTo(apiUrl: string): string {
  const origin = apiUrl.replace(/\/$/, '');
  return `${origin}/auth/callback?next=${encodeURIComponent('/reset-password')}`;
}

export function crmPageUrl(apiUrl: string, path: string): string {
  const origin = apiUrl.replace(/\/$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${suffix}`;
}

export function authCodeFromCallbackUrl(url: string): string | null {
  const normalized = url.includes('?') ? url : url.replace('#', '?');
  try {
    const parsed = new URL(normalized);
    return parsed.searchParams.get('code');
  } catch {
    const query = url.split('?')[1]?.split('#')[0] ?? url.split('#')[1];
    if (!query) return null;
    return new URLSearchParams(query).get('code');
  }
}

export function loginErrorFromCallback(code: string | undefined): string | null {
  if (!code) return null;
  if (code === 'missing_code') {
    return 'That sign-in link is missing a code. Request a new one.';
  }
  if (code === 'otp_expired') {
    return 'That confirmation link has expired. Request a new one from sign up.';
  }
  if (code === 'exchange_failed') {
    return 'That sign-in link is invalid or expired. Request a new one.';
  }
  return code;
}
