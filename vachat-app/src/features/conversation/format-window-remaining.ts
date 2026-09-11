export type WindowBand = 'normal' | 'warning' | 'critical' | 'expired';

export function windowBand(expiresAt: string | null, now = Date.now()): WindowBand {
  if (!expiresAt) return 'expired';
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return 'expired';
  const remaining = end - now;
  if (remaining <= 0) return 'expired';
  const hour = 60 * 60 * 1000;
  if (remaining < hour) return 'critical';
  if (remaining < 6 * hour) return 'warning';
  return 'normal';
}

export function formatWindowRemaining(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return '24h window expired';
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end) || end <= now) return '24h window expired';
  const remaining = end - now;
  const totalMinutes = Math.floor(remaining / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m left`;
  return `${hours}h ${minutes}m left`;
}

export function isWindowExpired(expiresAt: string | null, now = Date.now()): boolean {
  return windowBand(expiresAt, now) === 'expired';
}
