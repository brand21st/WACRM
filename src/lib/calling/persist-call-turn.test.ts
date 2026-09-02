import { describe, it, expect } from 'vitest'
import { callTurnMessageId, isCallTurnMessageId } from './persist-call-turn'

describe('call turn message ids', () => {
  it('encodes direction and is detectable', () => {
    const id = callTurnMessageId('call-1', 'in', '99')
    expect(id).toBe('callturn:call-1:in:99')
    expect(isCallTurnMessageId(id)).toBe(true)
    expect(isCallTurnMessageId('wamid.abc')).toBe(false)
  })
})
