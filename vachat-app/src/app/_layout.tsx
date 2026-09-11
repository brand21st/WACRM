import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { readPublicEnv } from '@/constants/env';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
import { SessionSmokeLogger } from '@/features/auth/session-smoke-logger';
import { IncomingAlertsHost } from '@/features/notifications/incoming-alerts-host';
import { InboxRealtimeHost } from '@/features/realtime/realtime-context';
import { EnvMissingScreen } from '@/features/shell/env-missing-screen';
import { createQueryClient } from '@/lib/query-client';

SplashScreen.preventAutoHideAsync();

function HydratedSplash() {
  const { isLoading } = useAuth();
  if (isLoading) return null;
  return <AnimatedSplashOverlay />;
}

function AppShell() {
  return (
    <ThemeProvider value={DefaultTheme}>
      <HydratedSplash />
      <SessionSmokeLogger />
      <InboxRealtimeHost>
        <IncomingAlertsHost>
          <Stack screenOptions={{ headerShown: false }} />
        </IncomingAlertsHost>
      </InboxRealtimeHost>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const env = readPublicEnv();

  if (!env.ok) {
    void SplashScreen.hideAsync();
    return <EnvMissingScreen missing={env.missing} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </QueryClientProvider>
  );
}
