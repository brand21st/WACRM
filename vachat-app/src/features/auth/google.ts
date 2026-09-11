import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { authCodeFromCallbackUrl, oauthRedirectTo } from '@/features/auth/oauth';
import { getSupabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

function googleRedirectTo(): string {
  const webOrigin =
    process.env.EXPO_OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined;
  return oauthRedirectTo({
    os: process.env.EXPO_OS,
    webOrigin,
    nativeRedirectUrl: Linking.createURL('auth/callback'),
  });
}

export async function signInWithGoogle(): Promise<{ error: Error | null }> {
  const supabase = getSupabase();
  const redirectTo = googleRedirectTo();

  if (process.env.EXPO_OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    return { error: error ? new Error(error.message) : null };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (error) return { error: new Error(error.message) };
  if (!data.url) return { error: new Error('Could not start Google sign-in.') };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { error: null };
  }
  if (result.type !== 'success' || !result.url) {
    return { error: new Error('Google sign-in did not complete.') };
  }

  const code = authCodeFromCallbackUrl(result.url);
  if (!code) {
    return { error: new Error('Google sign-in did not return a session.') };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  return { error: exchangeError ? new Error(exchangeError.message) : null };
}
