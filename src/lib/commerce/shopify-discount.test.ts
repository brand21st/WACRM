import { describe, expect, it } from 'vitest'
import { applyDiscountNodeToCart } from './shopify-discount'
import type { MappedCartLine } from './types'

const now = new Date('2026-09-04T10:00:00.000Z')

const bag: MappedCartLine = {
  retailer_id: 'BAG-RED',
  name: 'Red Bag',
  quantity: 2,
  amountPaise: 4900,
  variantId: '99',
  productId: '42',
  sku: 'BAG-RED',
}

function basic(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'DiscountCodeBasic',
    status: 'ACTIVE',
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: null,
    usageLimit: null,
    asyncUsageCount: 0,
    customerGets: {
      value: { percentage: 0.1 },
      items: { allItems: true },
    },
    ...overrides,
  }
}

describe('applyDiscountNodeToCart', () => {
  it('applies a 10% code to the cart subtotal', () => {
    const result = applyDiscountNodeToCart({
      code: 'SAVE10',
      node: basic(),
      lines: [bag],
      now,
    })
    expect(result).toEqual({
      ok: true,
      discount: {
        code: 'SAVE10',
        kind: 'percentage',
        percent: 10,
        amountPaise: 980,
      },
    })
  })

  it('applies a fixed amount and caps it at the eligible subtotal', () => {
    const result = applyDiscountNodeToCart({
      code: 'FLAT500',
      node: basic({
        customerGets: {
          value: {
            amount: { amount: '500.00', currencyCode: 'INR' },
            appliesOnEachItem: false,
          },
          items: { allItems: true },
        },
      }),
      lines: [bag],
      now,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.discount.kind).toBe('fixed')
      expect(result.discount.amountPaise).toBe(9800)
    }
  })

  it('rejects BXGY and collection-only codes', () => {
    expect(
      applyDiscountNodeToCart({
        code: 'BXGY',
        node: { __typename: 'DiscountCodeBxgy', status: 'ACTIVE' },
        lines: [bag],
        now,
      }).ok,
    ).toBe(false)
    expect(
      applyDiscountNodeToCart({
        code: 'COLLECT',
        node: basic({
          customerGets: {
            value: { percentage: 0.2 },
            items: { collections: { nodes: [{ id: 'gid://shopify/Collection/1' }] } },
          },
        }),
        lines: [bag],
        now,
      }).ok,
    ).toBe(false)
  })

  it('rejects expired codes and unmet minimums', () => {
    expect(
      applyDiscountNodeToCart({
        code: 'OLD',
        node: basic({ endsAt: '2026-01-01T00:00:00Z' }),
        lines: [bag],
        now,
      }).ok,
    ).toBe(false)
    expect(
      applyDiscountNodeToCart({
        code: 'MIN',
        node: basic({
          minimumRequirement: {
            greaterThanOrEqualToSubtotal: { amount: '500.00', currencyCode: 'INR' },
          },
        }),
        lines: [bag],
        now,
      }).ok,
    ).toBe(false)
  })
})
