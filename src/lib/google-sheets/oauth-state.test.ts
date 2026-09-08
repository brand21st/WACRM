import { describe, expect, it } from 'vitest'

import {
  signGoogleOAuthState,
  verifyGoogleOAuthState,
} from './oauth-state'

const ACCOUNT = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'

describe('google oauth state', () => {
  it('round-trips account and user ids', () => {
    const state = signGoogleOAuthState(ACCOUNT, USER)
    expect(verifyGoogleOAuthState(state)).toEqual({
      accountId: ACCOUNT,
      userId: USER,
    })
  })

  it('rejects tampered signatures', () => {
    const state = signGoogleOAuthState(ACCOUNT, USER)
    expect(verifyGoogleOAuthState(`${state}x`)).toBeNull()
    expect(verifyGoogleOAuthState('not-a-state')).toBeNull()
  })

  it('rejects expired state', () => {
    const state = signGoogleOAuthState(ACCOUNT, USER)
    expect(verifyGoogleOAuthState(state, -1)).toBeNull()
  })
})
