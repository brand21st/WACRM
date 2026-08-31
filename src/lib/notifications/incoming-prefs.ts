// Device-scoped incoming-message alert preferences. localStorage only
// — same pattern as theme/mode. A teammate's laptop and phone can
// disagree, which is what you want for a sound toggle.
//
// `getSnapshot` for useSyncExternalStore MUST return the same object
// reference when nothing changed; a fresh `{ sound, desktop }` every
// call would infinite-loop renders.

export const INCOMING_ALERTS_STORAGE_KEY = "wacrm:incoming-alerts";
export const INCOMING_ALERTS_EVENT = "wacrm:incoming-alerts-change";

export interface IncomingAlertPrefs {
  /** Play a chime on inbound customer messages. Default on. */
  sound: boolean;
  /** System Notification when this tab is in the background. Default on. */
  desktop: boolean;
}

export const DEFAULT_INCOMING_ALERT_PREFS: IncomingAlertPrefs = {
  sound: true,
  desktop: true,
};

let snapshot: IncomingAlertPrefs = DEFAULT_INCOMING_ALERT_PREFS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseIncomingAlertPrefs(raw: string | null): IncomingAlertPrefs {
  if (!raw) return { ...DEFAULT_INCOMING_ALERT_PREFS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_INCOMING_ALERT_PREFS };
    return {
      sound:
        typeof parsed.sound === "boolean"
          ? parsed.sound
          : DEFAULT_INCOMING_ALERT_PREFS.sound,
      desktop:
        typeof parsed.desktop === "boolean"
          ? parsed.desktop
          : DEFAULT_INCOMING_ALERT_PREFS.desktop,
    };
  } catch {
    return { ...DEFAULT_INCOMING_ALERT_PREFS };
  }
}

function samePrefs(a: IncomingAlertPrefs, b: IncomingAlertPrefs): boolean {
  return a.sound === b.sound && a.desktop === b.desktop;
}

function adopt(next: IncomingAlertPrefs): IncomingAlertPrefs {
  if (samePrefs(snapshot, next)) return snapshot;
  snapshot = next;
  return snapshot;
}

function readStored(): IncomingAlertPrefs {
  try {
    return parseIncomingAlertPrefs(
      localStorage.getItem(INCOMING_ALERTS_STORAGE_KEY),
    );
  } catch {
    return { ...DEFAULT_INCOMING_ALERT_PREFS };
  }
}

export function readIncomingAlertPrefs(): IncomingAlertPrefs {
  if (typeof window === "undefined") return DEFAULT_INCOMING_ALERT_PREFS;
  return adopt(readStored());
}

export function writeIncomingAlertPrefs(
  next: IncomingAlertPrefs,
): IncomingAlertPrefs {
  const prefs = adopt({ sound: next.sound, desktop: next.desktop });
  try {
    localStorage.setItem(INCOMING_ALERTS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // private-browsing / sandboxed — prefs still apply for this tab.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(INCOMING_ALERTS_EVENT));
  }
  return prefs;
}
