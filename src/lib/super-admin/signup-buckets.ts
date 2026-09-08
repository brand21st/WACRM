export const SIGNUP_GRAINS = ['day', 'month', 'year'] as const
export type SignupGrain = (typeof SIGNUP_GRAINS)[number]

export const SIGNUP_SORTS = ['newest', 'oldest'] as const
export type SignupSort = (typeof SIGNUP_SORTS)[number]

export interface SignupBucket {
  key: string
  label: string
  count: number
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

export function parseSignupGrain(raw: string | null | undefined): SignupGrain {
  return raw === 'month' || raw === 'year' ? raw : 'day'
}

export function parseSignupSort(raw: string | null | undefined): SignupSort {
  return raw === 'oldest' ? 'oldest' : 'newest'
}

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function utcMonthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export function signupWindowStart(grain: SignupGrain, now: Date): Date {
  if (grain === 'day') {
    const end = utcDayStart(now)
    return new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29),
    )
  }
  if (grain === 'month') {
    const end = utcMonthStart(now)
    return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1))
  }
  return new Date(Date.UTC(now.getUTCFullYear() - 4, 0, 1))
}

export function bucketKeyForDate(
  isoOrDate: string | Date,
  grain: SignupGrain,
): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(d.getTime())) return ''
  if (grain === 'day') return d.toISOString().slice(0, 10)
  if (grain === 'month') return d.toISOString().slice(0, 7)
  return String(d.getUTCFullYear())
}

export function formatBucketLabel(key: string, grain: SignupGrain): string {
  if (grain === 'day') {
    const parts = key.split('-').map(Number)
    const month = parts[1]
    const day = parts[2]
    if (!month || !day) return key
    return `${MONTH_SHORT[month - 1]} ${day}`
  }
  if (grain === 'month') {
    const [year, month] = key.split('-').map(Number)
    if (!year || !month) return key
    return `${MONTH_SHORT[month - 1]} ${year}`
  }
  return key
}

export function emptySignupBuckets(
  grain: SignupGrain,
  now: Date,
): SignupBucket[] {
  if (grain === 'day') {
    const start = signupWindowStart(grain, now)
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i),
      )
      const key = d.toISOString().slice(0, 10)
      return { key, label: formatBucketLabel(key, 'day'), count: 0 }
    })
  }
  if (grain === 'month') {
    const start = signupWindowStart(grain, now)
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1),
      )
      const key = d.toISOString().slice(0, 7)
      return { key, label: formatBucketLabel(key, 'month'), count: 0 }
    })
  }
  const year = now.getUTCFullYear()
  return Array.from({ length: 5 }, (_, i) => {
    const key = String(year - 4 + i)
    return { key, label: key, count: 0 }
  })
}

/** Chart buckets for the grain window. Dates outside the window are ignored. */
export function fillSignupBuckets(
  createdAts: Array<string | null | undefined>,
  grain: SignupGrain,
  now = new Date(),
): Array<{ label: string; count: number }> {
  const buckets = emptySignupBuckets(grain, now)
  const byKey = new Map(buckets.map((b) => [b.key, b]))
  const windowStart = signupWindowStart(grain, now).getTime()
  for (const iso of createdAts) {
    if (!iso) continue
    const d = new Date(iso)
    if (Number.isNaN(d.getTime()) || d.getTime() < windowStart) continue
    const bucket = byKey.get(bucketKeyForDate(d, grain))
    if (bucket) bucket.count += 1
  }
  return buckets.map(({ label, count }) => ({ label, count }))
}
