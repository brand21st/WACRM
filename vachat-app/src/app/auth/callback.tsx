import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { AUTH, AuthScreen } from '@/features/auth/auth-ui';
import { useAuth } from '@/features/auth/auth-context';
import { getSupabase } from '@/lib/supabase';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { session, isLoading } = useAuth();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string }>();
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function exchange() {
      if (typeof params.error === 'string' && params.error) {
        router.replace({
          pathname: '/auth/login',
          params: { error: params.error_description ?? params.error },
        });
        return;
      }

      const code = typeof params.code === 'string' ? params.code : null;
      if (!code) {
        router.replace({ pathname: '/auth/login', params: { error: 'missing_code' } });
        return;
      }

      const { error } = await getSupabase().auth.exchangeCodeForSession(code);
      if (cancelled) return;
      if (error) {
        setFailed(error.message);
        router.replace({ pathname: '/auth/login', params: { error: 'exchange_failed' } });
        return;
      }
      router.replace('/(tabs)/chats');
    }

    void exchange();
    return () => {
      cancelled = true;
    };
  }, [params.code, params.error, params.error_description, router]);

  if (!isLoading && session) {
    return <Redirect href="/(tabs)/chats" />;
  }

  return (
    <AuthScreen>
      <ActivityIndicator color={AUTH.green} />
      <Text style={styles.message}>{failed ?? 'Signing you in…'}</Text>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  message: {
    marginTop: 16,
    fontSize: 14,
    color: AUTH.subtitle,
    textAlign: 'center',
  },
});
