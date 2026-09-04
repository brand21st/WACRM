import { describe, expect, it } from 'vitest'
import { isWhatsAppCatalogRequest } from './catalog-intent'

describe('isWhatsAppCatalogRequest', () => {
  it('matches standalone catalog asks', () => {
    expect(isWhatsAppCatalogRequest('catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('catalogue')).toBe(true)
    expect(isWhatsAppCatalogRequest('show catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('browse the catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('whatsapp catalog')).toBe(true)
    expect(isWhatsAppCatalogRequest('show me your catalog')).toBe(true)
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
