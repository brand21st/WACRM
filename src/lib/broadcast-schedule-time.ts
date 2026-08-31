/**
 * Browser-local datetime helpers for the broadcast wizard.
 *
 * Date and time inputs speak local wall time without a timezone.
 * We convert to UTC ISO for `broadcasts.scheduled_at`.
 */

/** Minimum lead so the row is not already due when the user leaves Step 4. */
export const SCHEDULE_MIN_LEAD_MS = 2 * 60 * 1000;

/** Nudge step on the time stepper. */
export const SCHEDULE_NUDGE_MS = 15 * 60 * 1000;

export type SchedulePresetId = '15m' | '1h' | '3h' | 'tomorrow9';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Round up to the next local clock `stepMinutes` so the picker lands on a clean time. */
export function roundUpToMinutes(date: Date, stepMinutes: number = 5): Date {
  const next = new Date(date.getTime());
  const remainder = next.getMinutes() % stepMinutes;
  const extra = next.getSeconds() > 0 || next.getMilliseconds() > 0;
  if (remainder === 0 && !extra) {
    next.setSeconds(0, 0);
    return next;
  }
  const add = remainder === 0 ? stepMinutes : stepMinutes - remainder;
  next.setMinutes(next.getMinutes() + add, 0, 0);
  return next;
}

/** Format a Date as `YYYY-MM-DDTHH:mm` in the local timezone. */
export function toDatetimeLocalValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function splitDatetimeLocal(value: string): { date: string; time: string } {
  const [date = '', timePart = ''] = value.split('T');
  return { date, time: timePart.slice(0, 5) };
}

export function joinDatetimeLocal(date: string, time: string): string {
  if (!date || !time) return '';
  return `${date}T${time}`;
}

/** Default picker value: one hour from now, rounded to 5 minutes. */
export function defaultScheduleLocalValue(from: Date = new Date()): string {
  return toDatetimeLocalValue(
    roundUpToMinutes(new Date(from.getTime() + 60 * 60 * 1000)),
  );
}

export function schedulePresetLocalValue(
  id: SchedulePresetId,
  from: Date = new Date(),
): string {
  if (id === 'tomorrow9') {
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    next.setHours(9, 0, 0, 0);
    return toDatetimeLocalValue(next);
  }
  const offsetMs =
    id === '15m' ? 15 * 60 * 1000 : id === '1h' ? 60 * 60 * 1000 : 3 * 60 * 60 * 1000;
  return toDatetimeLocalValue(roundUpToMinutes(new Date(from.getTime() + offsetMs)));
}

/** Shift a datetime-local value, never below the minimum lead. */
export function shiftDatetimeLocal(
  value: string,
  deltaMs: number,
  now: Date = new Date(),
): string {
  const current = new Date(value);
  if (Number.isNaN(current.getTime())) return value;
  const next = new Date(current.getTime() + deltaMs);
  const min = new Date(now.getTime() + SCHEDULE_MIN_LEAD_MS);
  return toDatetimeLocalValue(next < min ? min : next);
}

/** Parse a datetime-local string to UTC ISO, or null if invalid. */
export function parseDatetimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function isScheduleAtLeastLead(
  iso: string,
  now: Date = new Date(),
  leadMs: number = SCHEDULE_MIN_LEAD_MS
): boolean {
  return new Date(iso).getTime() >= now.getTime() + leadMs;
}

export type ScheduleRelativeUnit = 'minutes' | 'hours' | 'days';

/** Whole units until `iso`, for the “in 45 minutes” preview. */
export function scheduleRelativeParts(
  iso: string,
  now: Date = new Date(),
): { unit: ScheduleRelativeUnit; count: number } {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 60_000));
  if (mins < 60) return { unit: 'minutes', count: mins };
  const hours = Math.round(mins / 60);
  if (hours < 48) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.round(hours / 24) };
}
