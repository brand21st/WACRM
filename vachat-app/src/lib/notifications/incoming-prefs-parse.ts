export interface IncomingAlertPrefs {
  sound: boolean;
  push: boolean;
}

export const DEFAULT_INCOMING_ALERT_PREFS: IncomingAlertPrefs = {
  sound: true,
  push: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseIncomingAlertPrefs(raw: string | null): IncomingAlertPrefs {
  if (!raw) return { ...DEFAULT_INCOMING_ALERT_PREFS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_INCOMING_ALERT_PREFS };
    return {
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULT_INCOMING_ALERT_PREFS.sound,
      push:
        typeof parsed.push === 'boolean'
          ? parsed.push
          : typeof parsed.desktop === 'boolean'
            ? parsed.desktop
            : DEFAULT_INCOMING_ALERT_PREFS.push,
    };
  } catch {
    return { ...DEFAULT_INCOMING_ALERT_PREFS };
  }
}
