import { describe, expect, it } from 'vitest'
import {
  FOLLOW_UP_DELAY_DEFAULT_MINUTES,
  FOLLOW_UP_DELAY_PRESETS_MINUTES,
  customFollowUpToMinutes,
  followUpDelayMinutesOrDefault,
  isFollowUpDelayPreset,
  parseFollowUpDelayMinutes,
} from './follow-up-delay'

describe('parseFollowUpDelayMinutes', () => {
  it('accepts presets and custom values from 1 to 1440', () => {
    for (const minutes of FOLLOW_UP_DELAY_PRESETS_MINUTES) {
      expect(parseFollowUpDelayMinutes(minutes)).toBe(minutes)
    }
    expect(parseFollowUpDelayMinutes(1)).toBe(1)
    expect(parseFollowUpDelayMinutes(1440)).toBe(1440)
    expect(parseFollowUpDelayMinutes('45')).toBe(45)
  })

  it('rejects 0 and values over 24 hours', () => {
    expect(parseFollowUpDelayMinutes(0)).toBeNull()
    expect(parseFollowUpDelayMinutes(1441)).toBeNull()
    expect(parseFollowUpDelayMinutes(-5)).toBeNull()
    expect(parseFollowUpDelayMinutes('nope')).toBeNull()
  })

  it('defaults missing values to 30 minutes', () => {
    expect(followUpDelayMinutesOrDefault(null)).toBe(
      FOLLOW_UP_DELAY_DEFAULT_MINUTES,
    )
    expect(isFollowUpDelayPreset(30)).toBe(true)
    expect(isFollowUpDelayPreset(45)).toBe(false)
  })
})

describe('customFollowUpToMinutes', () => {
  it('converts hours to minutes and validates the range', () => {
    expect(customFollowUpToMinutes(2, 'hours')).toBe(120)
    expect(customFollowUpToMinutes(1, 'minutes')).toBe(1)
    expect(customFollowUpToMinutes(24, 'hours')).toBe(1440)
    expect(customFollowUpToMinutes(25, 'hours')).toBeNull()
    expect(customFollowUpToMinutes(0, 'minutes')).toBeNull()
  })
})
