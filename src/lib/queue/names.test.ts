import { describe, expect, it } from 'vitest'

import {
  COMPLETED_JOB_RETENTION_SECONDS,
  DEFAULT_JOB_OPTIONS,
  FAILED_JOB_RETENTION_SECONDS,
  accountRunJobOptions,
  parseWorkerGroup,
} from './names'

describe('queue defaults', () => {
  it('keeps completed jobs briefly and caps 14-day failures', () => {
    expect(DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({
      age: COMPLETED_JOB_RETENTION_SECONDS,
      count: 1000,
    })
    expect(DEFAULT_JOB_OPTIONS.removeOnFail).toEqual({
      age: FAILED_JOB_RETENTION_SECONDS,
      count: 5000,
    })
    expect(COMPLETED_JOB_RETENTION_SECONDS).toBe(3600)
    expect(FAILED_JOB_RETENTION_SECONDS).toBe(14 * 24 * 60 * 60)
  })

  it('parses optional worker groups without accepting arbitrary values', () => {
    expect(parseWorkerGroup(' CUSTOMER ')).toBe('customer')
    expect(parseWorkerGroup('learning')).toBe('learning')
    expect(parseWorkerGroup('invalid')).toBe('all')
    expect(parseWorkerGroup(undefined)).toBe('all')
  })

  it('gives fixed account work unique runs with unfinished-run deduplication', () => {
    expect(accountRunJobOptions('acct:1', 'patterns', 'run-2')).toEqual({
      jobId: 'acct%3A1--patterns--run-2',
      deduplication: { id: 'acct%3A1--patterns' },
    })
    expect(() => accountRunJobOptions('acct-1', 'patterns', ' ')).toThrow(
      'cannot be empty',
    )
  })
})
