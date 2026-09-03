import { describe, expect, it } from 'vitest'
import { AccountSuspendedError, ForbiddenError } from './account'

describe('AccountSuspendedError', () => {
  it('is a 403 with a stable code', () => {
    const err = new AccountSuspendedError()
    expect(err).toBeInstanceOf(ForbiddenError)
    expect(err.status).toBe(403)
    expect(err.code).toBe('account_suspended')
  })
})
