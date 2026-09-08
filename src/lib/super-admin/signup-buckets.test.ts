import { describe, expect, it } from 'vitest'

import {
  fillSignupBuckets,
  parseSignupGrain,
  parseSignupSort,
  signupWindowStart,
} from './signup-buckets'

const NOW = new Date('2026-09-08T12:00:00.000Z')

describe('parseSignupGrain / parseSignupSort', () => {
  it('defaults grain to day and sort to newest', () => {
    expect(parseSignupGrain(null)).toBe('day')
    expect(parseSignupGrain('nope')).toBe('day')
    expect(parseSignupGrain('month')).toBe('month')
    expect(parseSignupSort(null)).toBe('newest')
    expect(parseSignupSort('oldest')).toBe('oldest')
  })
})

describe('fillSignupBuckets', () => {
  it('counts 30 daily buckets ending today and drops dates outside the window', () => {
    const buckets = fillSignupBuckets(
      [
        '2026-09-08T10:00:00.000Z',
        '2026-09-08T22:00:00.000Z',
        '2026-08-10T00:00:00.000Z',
        '2026-08-09T23:59:59.000Z',
      ],
      'day',
      NOW,
    )
    expect(buckets).toHaveLength(30)
    expect(signupWindowStart('day', NOW).toISOString()).toBe(
      '2026-08-10T00:00:00.000Z',
    )
    expect(buckets[0]).toEqual({ label: 'Aug 10', count: 1 })
    expect(buckets[buckets.length - 1]).toEqual({ label: 'Sep 8', count: 2 })
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3)
  })

  it('counts the last 12 UTC months', () => {
    const buckets = fillSignupBuckets(
      ['2025-10-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', '2025-09-01T00:00:00.000Z'],
      'month',
      NOW,
    )
    expect(buckets).toHaveLength(12)
    expect(buckets[0]).toEqual({ label: 'Oct 2025', count: 1 })
    expect(buckets[buckets.length - 1]).toEqual({ label: 'Sep 2026', count: 1 })
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(2)
  })

  it('counts the last 5 UTC years', () => {
    const buckets = fillSignupBuckets(
      ['2022-01-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2021-12-31T00:00:00.000Z'],
      'year',
      NOW,
    )
    expect(buckets.map((b) => b.label)).toEqual([
      '2022',
      '2023',
      '2024',
      '2025',
      '2026',
    ])
    expect(buckets[0].count).toBe(1)
    expect(buckets[4].count).toBe(1)
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(2)
  })
})
