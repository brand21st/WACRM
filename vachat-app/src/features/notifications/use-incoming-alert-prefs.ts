import { useCallback, useEffect, useSyncExternalStore } from 'react';

import {
  getIncomingAlertPrefs,
  loadIncomingAlertPrefs,
  subscribeIncomingAlertPrefs,
  writeIncomingAlertPrefs,
  type IncomingAlertPrefs,
} from '@/lib/notifications/incoming-prefs';

export function useIncomingAlertPrefs() {
  const prefs = useSyncExternalStore(
    subscribeIncomingAlertPrefs,
    getIncomingAlertPrefs,
    getIncomingAlertPrefs,
  );

  useEffect(() => {
    void loadIncomingAlertPrefs();
  }, []);

  const setPrefs = useCallback((next: Partial<IncomingAlertPrefs>) => {
    void writeIncomingAlertPrefs(next);
  }, []);

  return { prefs, setPrefs };
}
