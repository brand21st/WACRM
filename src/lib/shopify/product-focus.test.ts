import { describe, expect, it } from 'vitest'
import {
  cardMatchesProductFocus,
  formatProductFocusNote,
  looksLikeNativeCartTalk,
  parseProductFocus,
  productFocusFromMessage,
  scopeMessagesToProductFocus,
  shouldClearDraftFocus,
  titleFromCardText,
  wantsProductOrder,
} from './product-focus'

describe('productFocusFromMessage', () => {
  it('reads handle and variant from a checkout CTA payload', () => {
    const focus = productFocusFromMessage({
      id: 'msg-1',
      content_type: 'interactive',
      content_text: 'Pournami\n499 INR\nStock in\nView: https://shop.example/products/pournami-red',
      interactive_payload: {
        kind: 'cta_url',
        body: 'Pournami\n499 INR\nStock in\nView: https://shop.example/products/pournami-red',
        display_text: 'Checkout NOW',
        url: 'https://shop.example/cart/12:1?checkout',
        shopify_handle: 'pournami-red',
        shopify_variant_id: '12',
      },
    })
    expect(focus).toMatchObject({
      handle: 'pournami-red',
      variantId: '12',
      title: 'Pournami',
      sourceMessageId: 'msg-1',
    })
  })

  it('parses View URL and cart URL from an image caption', () => {
    const focus = productFocusFromMessage({
      id: 'img-1',
      content_type: 'image',
      content_text:
        'Silk Saree\n1499 INR\nStock in\nView: https://shop.example/products/silk-saree\nhttps://shop.example/cart/99:1?checkout',
    })
    expect(focus).toMatchObject({
      handle: 'silk-saree',
      variantId: '99',
      title: 'Silk Saree',
      sourceMessageId: 'img-1',
    })
  })

  it('returns null when the bubble is not a product card', () => {
    expect(
      productFocusFromMessage({
        id: 'txt-1',
        content_type: 'text',
        content_text: 'Hello there',
      }),
    ).toBeNull()
  })
})

describe('parseProductFocus', () => {
  it('accepts a stored jsonb row', () => {
    expect(
      parseProductFocus({
        handle: 'pournami-red',
        sourceMessageId: 'msg-1',
        stage: 'ready_to_confirm',
        setBy: 'send',
        variantId: '12',
        introSent: true,
      }),
    ).toMatchObject({
      handle: 'pournami-red',
      stage: 'ready_to_confirm',
      setBy: 'send',
      variantId: '12',
      introSent: true,
    })
  })

  it('rejects rows without a handle', () => {
    expect(parseProductFocus({ sourceMessageId: 'msg-1' })).toBeNull()
  })
})

describe('wantsProductOrder', () => {
  it('detects order intent and confirm taps', () => {
    expect(wantsProductOrder('I want to order this')).toBe(true)
    expect(wantsProductOrder('send me the link')).toBe(true)
    expect(
      wantsProductOrder('[Customer tapped "Confirm order" (action: wacrm:confirm_order)]'),
    ).toBe(true)
    expect(wantsProductOrder('what fabric is this?')).toBe(false)
  })

  it('detects spoken and typed buy lines the customer actually says', () => {
    for (const line of [
      'I want to buy',
      'I want to buy this',
      'wanna buy',
      'I wanna buy this one',
      'can I buy',
      "I'll buy",
      'i will take it',
      'need to order',
      'wants to purchase',
      'വാങ്ങണം',
      'ऑर्डर करना है',
      'Enikk ithu purchase cheyanam',
    ]) {
      expect(wantsProductOrder(line), line).toBe(true)
    }
    expect(wantsProductOrder('[Customer sent a voice note]')).toBe(false)
    expect(wantsProductOrder('how much is shipping?')).toBe(false)
  })

  it('detects WhatsApp cart-summary talk', () => {
    expect(looksLikeNativeCartTalk('There are now 3 items in your cart.')).toBe(true)
    expect(looksLikeNativeCartTalk('Add to cart, then Send order. Review and Pay.')).toBe(
      true,
    )
    expect(looksLikeNativeCartTalk('Choose a color for Pournami.')).toBe(false)
  })
})

describe('titleFromCardText / notes', () => {
  it('uses the first caption line as the title', () => {
    expect(titleFromCardText('Pournami\n499 INR\nView: https://x/products/p')).toBe(
      'Pournami',
    )
  })

  it('formats the model note', () => {
    expect(formatProductFocusNote({ handle: 'pournami-red', title: 'Pournami' })).toBe(
      'Replying to product: Pournami (pournami-red)',
    )
  })
})

describe('scopeMessagesToProductFocus', () => {
  const focus = { handle: 'pournami-red', title: 'Pournami' }

  it('keeps chat and the selected card, drops other product cards', () => {
    const scoped = scopeMessagesToProductFocus(
      [
        {
          role: 'assistant',
          content:
            'Silk Saree\n1499 INR\nStock in\nView: https://shop.example/products/silk-saree',
        },
        {
          role: 'assistant',
          content:
            'Pournami\n499 INR\nStock in\nView: https://shop.example/products/pournami-red',
        },
        { role: 'user', content: 'tell me more about this' },
      ],
      focus,
    )
    expect(scoped.map((m) => m.content)).toEqual([
      'Pournami\n499 INR\nStock in\nView: https://shop.example/products/pournami-red',
      'tell me more about this',
    ])
  })

  it('drops WhatsApp cart-summary replies so the model does not repeat them', () => {
    const scoped = scopeMessagesToProductFocus(
      [
        {
          role: 'assistant',
          content: 'നിങ്ങളുടെ cart-ൽ ഇപ്പോൾ 3 items ഉണ്ട്. Add to cart ചെയ്യൂ.',
        },
        { role: 'user', content: 'Enikk ithu purchase cheyanam' },
      ],
      focus,
    )
    expect(scoped.map((m) => m.content)).toEqual([
      'Enikk ithu purchase cheyanam',
    ])
  })

  it('matches a card by handle', () => {
    expect(
      cardMatchesProductFocus(
        { handle: 'pournami-red', title: 'Pournami' },
        focus,
      ),
    ).toBe(true)
    expect(
      cardMatchesProductFocus({ handle: 'silk-saree', title: 'Silk Saree' }, focus),
    ).toBe(false)
  })
})

describe('shouldClearDraftFocus', () => {
  it('clears only an unsaved reply-draft for the same card', () => {
    expect(
      shouldClearDraftFocus(
        {
          handle: 'pournami-red',
          sourceMessageId: 'msg-1',
          stage: 'focused',
          setBy: 'reply_draft',
        },
        'msg-1',
      ),
    ).toBe(true)
    expect(
      shouldClearDraftFocus(
        {
          handle: 'pournami-red',
          sourceMessageId: 'msg-1',
          stage: 'focused',
          setBy: 'send',
        },
        'msg-1',
      ),
    ).toBe(false)
  })
})
