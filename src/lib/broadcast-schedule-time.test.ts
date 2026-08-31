import { describe, expect, it } from 'vitest';

import {
  defaultScheduleLocalValue,
  isScheduleAtLeastLead,
  joinDatetimeLocal,
  parseDatetimeLocalToIso,
  roundUpToMinutes,
  SCHEDULE_MIN_LEAD_MS,
  schedulePresetLocalValue,
  scheduleRelativeParts,
  shiftDatetimeLocal,
  splitDatetimeLocal,
  toDatetimeLocalValue,
} from './broadcast-schedule-time';

describe('toDatetimeLocalValue', () => {
  it('formats local wall time without seconds or a timezone', () => {
    const d = new Date(2026, 7, 26, 15, 4, 59);
    expect(toDatetimeLocalValue(d)).toBe('2026-08-26T15:04');
  });
});

describe('roundUpToMinutes', () => {
  it('keeps times already on a 5-minute mark', () => {
    const d = new Date(2026, 7, 26, 15, 15, 0);
    expect(toDatetimeLocalValue(roundUpToMinutes(d))).toBe('2026-08-26T15:15');
  });

  it('rounds 15:16 up to 15:20 on the local clock', () => {
    const d = new Date(2026, 7, 26, 15, 16, 0);
    expect(toDatetimeLocalValue(roundUpToMinutes(d))).toBe('2026-08-26T15:20');
  });
});

describe('defaultScheduleLocalValue', () => {
  it('is one hour ahead of the given instant', () => {
    const from = new Date(2026, 7, 26, 15, 0, 0);
    expect(defaultScheduleLocalValue(from)).toBe('2026-08-26T16:00');
  });

  it('rounds the default up to the next 5 minutes', () => {
    const from = new Date(2026, 7, 26, 15, 1, 0);
    expect(defaultScheduleLocalValue(from)).toBe('2026-08-26T16:05');
  });
});

describe('parseDatetimeLocalToIso', () => {
  it('returns null for empty or invalid input', () => {
    expect(parseDatetimeLocalToIso('')).toBeNull();
    expect(parseDatetimeLocalToIso('not-a-date')).toBeNull();
  });

  it('round-trips a datetime-local value through Date', () => {
    const iso = parseDatetimeLocalToIso('2026-08-26T15:04');
    expect(iso).toBeTruthy();
    const again = new Date(iso!);
    expect(toDatetimeLocalValue(again)).toBe('2026-08-26T15:04');
  });
});

describe('splitDatetimeLocal / joinDatetimeLocal', () => {
  it('splits and rejoins a datetime-local value', () => {
    expect(splitDatetimeLocal('2026-08-27T00:08')).toEqual({
      date: '2026-08-27',
      time: '00:08',
    });
    expect(joinDatetimeLocal('2026-08-27', '00:08')).toBe('2026-08-27T00:08');
  });
});

describe('schedulePresetLocalValue', () => {
  it('lands 15 minutes ahead, rounded up to 5 minutes', () => {
    const from = new Date(2026, 7, 26, 15, 1, 0);
    expect(schedulePresetLocalValue('15m', from)).toBe('2026-08-26T15:20');
  });

  it('sets tomorrow 9:00 local', () => {
    const from = new Date(2026, 7, 26, 22, 0, 0);
    expect(schedulePresetLocalValue('tomorrow9', from)).toBe('2026-08-27T09:00');
  });
});

describe('shiftDatetimeLocal', () => {
  it('nudges by the given delta', () => {
    expect(
      shiftDatetimeLocal('2026-08-27T00:08', 15 * 60 * 1000, new Date(2026, 7, 26, 12, 0)),
    ).toBe('2026-08-27T00:23');
  });

  it('does not go below the minimum lead', () => {
    const now = new Date(2026, 7, 26, 15, 0, 0);
    expect(shiftDatetimeLocal('2026-08-26T15:01', -15 * 60 * 1000, now)).toBe(
      '2026-08-26T15:02',
    );
  });
});

describe('scheduleRelativeParts', () => {
  it('uses minutes under an hour and hours after that', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    expect(
      scheduleRelativeParts(new Date(now.getTime() + 45 * 60 * 1000).toISOString(), now),
    ).toEqual({ unit: 'minutes', count: 45 });
    expect(
      scheduleRelativeParts(new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(), now),
    ).toEqual({ unit: 'hours', count: 3 });
  });
});

describe('isScheduleAtLeastLead', () => {
  it('rejects times inside the lead window', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    const tooSoon = new Date(now.getTime() + SCHEDULE_MIN_LEAD_MS - 1).toISOString();
    expect(isScheduleAtLeastLead(tooSoon, now)).toBe(false);
  });

  it('accepts times at or past the lead window', () => {
    const now = new Date('2026-08-26T12:00:00Z');
    const ok = new Date(now.getTime() + SCHEDULE_MIN_LEAD_MS).toISOString();
    expect(isScheduleAtLeastLead(ok, now)).toBe(true);
  });
});
