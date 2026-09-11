import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { resyncInboxQueries } from '@/features/realtime/resync-queries';
import { getSupabase } from '@/lib/supabase';

export function useForegroundResync(enabled: boolean) {
  const queryClient = useQueryClient();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener('change', (next) => {
      const wasBackground = appStateRef.current === 'inactive' || appStateRef.current === 'background';
      appStateRef.current = next;
      if (!wasBackground || next !== 'active') return;
      void getSupabase().auth.getSession();
      resyncInboxQueries(queryClient);
    });

    return () => {
      subscription.remove();
    };
  }, [enabled, queryClient]);
}
