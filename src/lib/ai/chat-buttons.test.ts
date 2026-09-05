import { describe, expect, it } from 'vitest'

import {
  buildAiChatButtons,
  buildCartOfferButtons,
  buildProductOrderButtons,
  formatButtonTapForModel,
  lastMessageHasAction,
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

describe('buildCartOfferButtons', () => {
  it('returns confirm and more-options within Meta’s 20-char limit', () => {
    const buttons = buildCartOfferButtons()
    expect(buttons).toEqual([
      { id: WACRM_CHAT_BUTTON_IDS.confirmOrder, title: 'Confirm order' },
      { id: WACRM_CHAT_BUTTON_IDS.moreOptions, title: 'Check other options' },
    ])
    expect(buttons.every((b) => b.title.length <= 20)).toBe(true)
  })
})

describe('buildProductOrderButtons', () => {
  it('returns confirm and continue-chat within Meta’s 20-char limit', () => {
    const buttons = buildProductOrderButtons()
    expect(buttons).toEqual([
      { id: WACRM_CHAT_BUTTON_IDS.confirmOrder, title: 'Confirm order' },
      { id: WACRM_CHAT_BUTTON_IDS.continueChat, title: 'Continue chat' },
    ])
    expect(buttons.every((b) => b.title.length <= 20)).toBe(true)
  })
})

describe('lastMessageHasAction', () => {
  it('detects a wacrm action id in the last message', () => {
    expect(
      lastMessageHasAction(
        [
          { content: 'hello' },
          {
            content: '[Customer tapped "Confirm order" (action: wacrm:confirm_order)]',
          },
        ],
        WACRM_CHAT_BUTTON_IDS.confirmOrder,
      ),
    ).toBe(true)
    expect(
      lastMessageHasAction(
        [{ content: '[Customer tapped "Check other options" (action: wacrm:more_options)]' }],
        WACRM_CHAT_BUTTON_IDS.confirmOrder,
      ),
    ).toBe(false)
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
