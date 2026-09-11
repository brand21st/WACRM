import { createContext, useContext, type ReactNode } from 'react';

import { useAuth } from '@/features/auth/auth-context';
import { useForegroundResync } from '@/features/realtime/use-foreground-resync';
import { useInboxRealtime, type RealtimeStatus } from '@/features/realtime/use-inbox-realtime';

const RealtimeStatusContext = createContext<RealtimeStatus>({
  isConnected: false,
  everConnected: false,
});

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeStatusContext);
}

export function InboxRealtimeHost({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const enabled = Boolean(session);
  const status = useInboxRealtime(enabled);
  useForegroundResync(enabled);

  return <RealtimeStatusContext.Provider value={status}>{children}</RealtimeStatusContext.Provider>;
}
