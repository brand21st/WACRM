import { describe, expect, it } from 'vitest'
import {
  formatCommerceSnapshot,
  hasOpenCommercePending,
  isCommerceAffirmation,
  isImmediateShowAsk,
  isPhotoRequest,
  parseCommerceTurn,
  resolveCommerceFollowUp,
  serializeCommerceTurn,
} from './commerce-turn'

const CARD = {
  title: 'Aline Cord Set',
  imageUrl: 'https://cdn.example/cord.jpg',
  productUrl: 'https://shop.example/products/cord-set',
  cartUrl: null,
  checkoutUrl: 'https://shop.example/cart/1:1?checkout',
  inStock: true,
  caption: 'Aline Cord Set\n500 INR',
}

describe('commerce follow-up resolution', () => {
  it('treats ok as accept when SHOW_PRODUCT is pending', () => {
    const turn = parseCommerceTurn({
      conversationId: 'c1',
      pendingAction: 'SHOW_PRODUCT',
      lastOfferedCards: [CARD],
    })
    expect(resolveCommerceFollowUp('ok', turn)).toBe('accept_show')
    expect(resolveCommerceFollowUp('വേണം', turn)).toBe('accept_show')
    expect(resolveCommerceFollowUp('കാണിക്കൂ', turn)).toBe('accept_show')
  })

  it('treats ok as a greeting when nothing is pending', () => {
    expect(resolveCommerceFollowUp('ok', null)).toBe('none')
    expect(resolveCommerceFollowUp('ok', parseCommerceTurn({ conversationId: 'c1' }))).toBe(
      'none',
    )
  })

  it('treats photo please as an image request when a product is known', () => {
    const turn = parseCommerceTurn({
      conversationId: 'c1',
      lastOfferedCards: [CARD],
      acceptedAlternative: true,
    })
    expect(resolveCommerceFollowUp('photo please', turn)).toBe('request_image')
    expect(resolveCommerceFollowUp('ഫോട്ടോ വേണം', turn)).toBe('request_image')
    expect(isPhotoRequest('pic')).toBe(true)
  })

  it('detects affirmations and immediate show asks', () => {
    expect(isCommerceAffirmation('yes')).toBe(true)
    expect(isCommerceAffirmation('ശരി')).toBe(true)
    expect(isImmediateShowAsk('499 cord set വേണം')).toBe(false)
    expect(isImmediateShowAsk('cord set കാണിക്കൂ')).toBe(true)
  })
})

describe('commerce turn parse', () => {
  it('round-trips conversation-scoped fields', () => {
    const raw = serializeCommerceTurn({
      conversationId: 'conv-1',
      currentProduct: 'Cord Set',
      requestedPrice: 499,
      alternativePrice: 500,
      lastOfferedCards: [CARD],
      pendingAction: 'SHOW_PRODUCT',
      pendingQuestion: 'show_alternative',
      acceptedAlternative: false,
      unavailabilityTold: true,
    })
    const parsed = parseCommerceTurn(raw)
    expect(parsed?.requestedPrice).toBe(499)
    expect(parsed?.alternativePrice).toBe(500)
    expect(parsed?.pendingAction).toBe('SHOW_PRODUCT')
    expect(hasOpenCommercePending(parsed)).toBe(true)
  })

  it('formats snapshot lines for the prompt', () => {
    const snap = formatCommerceSnapshot({
      conversationId: 'c1',
      requestedPrice: 499,
      alternativePrice: 500,
      lastOfferedCards: [CARD],
      pendingAction: 'SHOW_PRODUCT',
      unavailabilityTold: true,
    })
    expect(snap).toMatch(/requested_price: 499/)
    expect(snap).toMatch(/alternative_price: 500/)
    expect(snap).toMatch(/pending_action: SHOW_PRODUCT/)
    expect(snap).toMatch(/do_not_repeat_unavailability: yes/)
  })
})
