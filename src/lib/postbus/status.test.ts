import { describe, expect, it } from 'vitest'

import { isValidPostBusStatusTransition } from './status'

describe('isValidPostBusStatusTransition', () => {
  it('allows forward ladder moves and failed from sent', () => {
    expect(isValidPostBusStatusTransition('sent', 'delivered')).toBe(true)
    expect(isValidPostBusStatusTransition('delivered', 'sent')).toBe(false)
    expect(isValidPostBusStatusTransition('sent', 'failed')).toBe(true)
    expect(isValidPostBusStatusTransition('delivered', 'failed')).toBe(false)
  })
})
