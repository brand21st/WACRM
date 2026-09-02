/** WhatsApp customer-service window: 24h after the last inbound message. */

export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SESSION_WINDOW_SOON_MS = 4 * 60 * 60 * 1000;
export const SESSION_WINDOW_URGENT_MS = 60 * 60 * 1000;

export type SessionWindowUrgency = "ok" | "soon" | "urgent" | "expired";

export function customerServiceExpiresAt(
  createdAt: string | Date | null | undefined,
): Date | null {
  if (createdAt == null) return null;
  const start = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
}

export function sessionWindowMsLeft(expiresAt: Date | null, now = Date.now()): number {
  if (!expiresAt) return 0;
  return expiresAt.getTime() - now;
}

export function formatSessionCountdown(msLeft: number): {
  hours: number;
  minutes: number;
  seconds: number;
  label: string;
} {
  const clamped = Math.max(0, Math.floor(msLeft));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return {
    hours,
    minutes,
    seconds,
    label: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`,
  };
}

export function sessionWindowUrgency(msLeft: number): SessionWindowUrgency {
  if (msLeft <= 0) return "expired";
  if (msLeft < SESSION_WINDOW_URGENT_MS) return "urgent";
  if (msLeft < SESSION_WINDOW_SOON_MS) return "soon";
  return "ok";
}
