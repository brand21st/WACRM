import { describe, expect, it } from 'vitest'
import {
  formatProductFocusNote,
  parseProductFocus,
  productFocusFromMessage,
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
