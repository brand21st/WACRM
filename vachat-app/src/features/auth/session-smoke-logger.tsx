import { useEffect, useRef } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { runSessionSmoke } from '@/features/auth/session-smoke';

export function SessionSmokeLogger() {
  const { accessToken, isLoading } = useAuth();
  const lastToken = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading || !accessToken) {
      if (!accessToken) lastToken.current = null;
      return;
    }
    if (lastToken.current === accessToken) return;
    lastToken.current = accessToken;
    void runSessionSmoke();
  }, [accessToken, isLoading]);

  return null;
}
