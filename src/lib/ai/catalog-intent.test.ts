import { describe, expect, it } from 'vitest'
import {
  isCatalogFollowUp,
  isWhatsAppCatalogRequest,
  recentTurnMentionedCatalog,
  replyClaimsCatalogSent,
  wantsWhatsAppCatalog,
} from './catalog-intent'

describe('isWhatsAppCatalogRequest', () => {
  it('matches standalone catalog asks', () => {
    expect(isWhatsAppCatalogRequest('catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('catalogue')).toBe(true)
    expect(isWhatsAppCatalogRequest('show catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('browse the catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('whatsapp catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('show me your catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('product catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('product, catalog, browse, refresh')).toBe(
      true,
    )
  })

  it('matches what-all-products and Manglish catalog asks', () => {
    expect(isWhatsAppCatalogRequest('Endhokke products?')).toBe(true)
    expect(isWhatsAppCatalogRequest('what products')).toBe(true)
    expect(isWhatsAppCatalogRequest('show products')).toBe(true)
    expect(isWhatsAppCatalogRequest('all products')).toBe(true)
    expect(isWhatsAppCatalogRequest('list products')).toBe(true)
  })

  it('does not treat product searches as catalog asks', () => {
    expect(isWhatsAppCatalogRequest('show me red bags')).toBe(false)
    expect(isWhatsAppCatalogRequest('catalog of red bags')).toBe(false)
    expect(isWhatsAppCatalogRequest('new products')).toBe(false)
    expect(isWhatsAppCatalogRequest('hi')).toBe(false)
    expect(
      isWhatsAppCatalogRequest(
        '[Customer tapped "New products" (action: wacrm:products)]',
      ),
    ).toBe(false)
  })
})

describe('wantsWhatsAppCatalog', () => {
  it('sends when the model claimed the catalog went out', () => {
    expect(
      wantsWhatsAppCatalog({
        customerText: 'hi',
        replyText: 'Catalog sent. Browse it in chat.',
      }),
    ).toBe(true)
    expect(replyClaimsCatalogSent('Browse our catalog in chat.')).toBe(true)
  })

  it('resends on where / cannot-see follow-ups', () => {
    expect(isCatalogFollowUp('Evide')).toBe(true)
    expect(isCatalogFollowUp('Kannunilla')).toBe(true)
    expect(
      recentTurnMentionedCatalog([
        { role: 'assistant', content: 'Catalog is in the chat now.' },
        { role: 'user', content: 'Evide' },
      ]),
    ).toBe(true)
    expect(
      wantsWhatsAppCatalog({
        customerText: 'Evide',
        messages: [
          { role: 'assistant', content: 'Catalog അയച്ചു കഴിഞ്ഞു.' },
          { role: 'user', content: 'Evide' },
        ],
      }),
    ).toBe(true)
  })
})
