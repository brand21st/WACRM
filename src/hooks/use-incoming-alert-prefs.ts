"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_INCOMING_ALERT_PREFS,
  INCOMING_ALERTS_EVENT,
  INCOMING_ALERTS_STORAGE_KEY,
  type IncomingAlertPrefs,
  readIncomingAlertPrefs,
  writeIncomingAlertPrefs,
} from "@/lib/notifications/incoming-prefs";

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = () => onStoreChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key === INCOMING_ALERTS_STORAGE_KEY || event.key === null) {
      onChange();
    }
  };
  window.addEventListener(INCOMING_ALERTS_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(INCOMING_ALERTS_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): IncomingAlertPrefs {
  return readIncomingAlertPrefs();
}

function getServerSnapshot(): IncomingAlertPrefs {
  return DEFAULT_INCOMING_ALERT_PREFS;
}

export function useIncomingAlertPrefs() {
  const prefs = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setPrefs = useCallback((patch: Partial<IncomingAlertPrefs>) => {
    const current = readIncomingAlertPrefs();
    writeIncomingAlertPrefs({ ...current, ...patch });
  }, []);

  return { prefs, setPrefs };
}
