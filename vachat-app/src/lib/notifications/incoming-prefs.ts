import { secureStoreAdapter } from '../secure-store';

import {
  DEFAULT_INCOMING_ALERT_PREFS,
  parseIncomingAlertPrefs,
  type IncomingAlertPrefs,
} from './incoming-prefs-parse';

export const INCOMING_ALERTS_STORAGE_KEY = 'wacrm:incoming-alerts';
export {
  DEFAULT_INCOMING_ALERT_PREFS,
  parseIncomingAlertPrefs,
  type IncomingAlertPrefs,
} from './incoming-prefs-parse';

let snapshot: IncomingAlertPrefs = DEFAULT_INCOMING_ALERT_PREFS;
const listeners = new Set<() => void>();

function samePrefs(a: IncomingAlertPrefs, b: IncomingAlertPrefs): boolean {
  return a.sound === b.sound && a.push === b.push;
}

function adopt(next: IncomingAlertPrefs): IncomingAlertPrefs {
  if (samePrefs(snapshot, next)) return snapshot;
  snapshot = next;
  for (const listener of listeners) listener();
  return snapshot;
}

export function getIncomingAlertPrefs(): IncomingAlertPrefs {
  return snapshot;
}

export function subscribeIncomingAlertPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadIncomingAlertPrefs(): Promise<IncomingAlertPrefs> {
  try {
    return adopt(parseIncomingAlertPrefs(await secureStoreAdapter.getItem(INCOMING_ALERTS_STORAGE_KEY)));
  } catch {
    return adopt({ ...DEFAULT_INCOMING_ALERT_PREFS });
  }
}

export async function writeIncomingAlertPrefs(
  next: Partial<IncomingAlertPrefs>,
): Promise<IncomingAlertPrefs> {
  const prefs = adopt({
    sound: next.sound ?? snapshot.sound,
    push: next.push ?? snapshot.push,
  });
  try {
    await secureStoreAdapter.setItem(INCOMING_ALERTS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // sandboxed / full disk — in-memory prefs still apply.
  }
  return prefs;
}
