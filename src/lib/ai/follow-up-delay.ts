/** Preset delays shown in Agents setup (minutes). */
export const FOLLOW_UP_DELAY_PRESETS_MINUTES = [
  15, 30, 60, 120, 180, 360, 720, 1440,
] as const

export const FOLLOW_UP_DELAY_MIN_MINUTES = 1
export const FOLLOW_UP_DELAY_MAX_MINUTES = 1440
export const FOLLOW_UP_DELAY_DEFAULT_MINUTES = 30

export type FollowUpDelayPresetMinutes =
  (typeof FOLLOW_UP_DELAY_PRESETS_MINUTES)[number]

export function isFollowUpDelayPreset(
  minutes: number,
): minutes is FollowUpDelayPresetMinutes {
  return (FOLLOW_UP_DELAY_PRESETS_MINUTES as readonly number[]).includes(
    minutes,
  )
}

/**
 * Parse a follow-up delay in minutes. Returns null when the value is
 * missing or outside 1–1440 (custom range: 1 minute to 24 hours).
 */
export function parseFollowUpDelayMinutes(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isFinite(n)) return null
  const minutes = Math.floor(n)
  if (
    minutes < FOLLOW_UP_DELAY_MIN_MINUTES ||
    minutes > FOLLOW_UP_DELAY_MAX_MINUTES
  ) {
    return null
  }
  return minutes
}

export function followUpDelayMinutesOrDefault(raw: unknown): number {
  return parseFollowUpDelayMinutes(raw) ?? FOLLOW_UP_DELAY_DEFAULT_MINUTES
}

/** Convert a custom amount + unit into minutes. Hours are whole hours. */
export function customFollowUpToMinutes(
  amount: unknown,
  unit: 'minutes' | 'hours',
): number | null {
  const n = typeof amount === 'number' ? amount : Number(String(amount ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return null
  const whole = Math.floor(n)
  const minutes = unit === 'hours' ? whole * 60 : whole
  return parseFollowUpDelayMinutes(minutes)
}
