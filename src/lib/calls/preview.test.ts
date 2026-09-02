import { describe, it, expect } from 'vitest'
import {
  encodeCallPreview,
  parseCallPreview,
  formatCallDuration,
  callListPreview,
} from './preview'

describe('call preview encoding', () => {
  it('round-trips status and duration', () => {
    expect(parseCallPreview(encodeCallPreview('ringing'))).toEqual({
      status: 'ringing',
      durationSeconds: null,
    })
    expect(parseCallPreview(encodeCallPreview('completed', 125))).toEqual({
      status: 'completed',
      durationSeconds: 125,
    })
    expect(parseCallPreview('hello')).toBeNull()
  })

  it('formats mm:ss', () => {
    expect(formatCallDuration(0)).toBe('0:00')
    expect(formatCallDuration(125)).toBe('2:05')
  })

  it('builds a list preview from stored tokens', () => {
    const labels = {
      incoming: 'Incoming call',
      missed: 'Missed call',
      completed: (d: string) => `Call (${d})`,
      completedUnknown: 'Call',
      rejected: 'Declined call',
      failed: 'Call failed',
      inProgress: 'On a call',
    }
    expect(callListPreview('call:missed', labels)).toBe('Missed call')
    expect(callListPreview('call:completed:65', labels)).toBe('Call (1:05)')
    expect(callListPreview('hello', labels)).toBeNull()
  })
})
