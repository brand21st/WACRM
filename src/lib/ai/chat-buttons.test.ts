import { describe, expect, it } from 'vitest'

import {
  buildAiChatButtons,
  formatButtonTapForModel,
  WACRM_CHAT_BUTTON_IDS,
} from './chat-buttons'

describe('buildAiChatButtons', () => {
  it('returns shopify actions when store is connected', () => {
    const buttons = buildAiChatButtons(true)
    expect(buttons).toHaveLength(3)
    expect(buttons[0].id).toBe(WACRM_CHAT_BUTTON_IDS.products)
  })

  it('returns help + agent without shopify', () => {
    const buttons = buildAiChatButtons(false)
    expect(buttons).toHaveLength(2)
    expect(buttons.map((b) => b.id)).toEqual([
      WACRM_CHAT_BUTTON_IDS.help,
      WACRM_CHAT_BUTTON_IDS.agent,
    ])
  })
})

describe('formatButtonTapForModel', () => {
  it('annotates wacrm button taps', () => {
    expect(
      formatButtonTapForModel('New products', WACRM_CHAT_BUTTON_IDS.products),
    ).toContain('wacrm:products')
  })

  it('passes through plain text', () => {
    expect(formatButtonTapForModel('Hello', null)).toBe('Hello')
  })
})
