import { describe, expect, it, vi } from 'vitest'

import { MissingAccountIdError } from './contracts'
import {
  applyOwnedCatalogMetadata,
  loadOwnedCatalogRefs,
} from './owned-catalog-refs'

describe('applyOwnedCatalogMetadata', () => {
  it('drops product and variant ids that the tenant does not own', () => {
    expect(
      applyOwnedCatalogMetadata(
        { productId: 'prod-a', variantId: 'var-a', category: 'Kurti' },
        { productIds: new Set(['prod-b']), variantIds: new Set() }
      )
    ).toEqual({ category: 'Kurti' })
  })

  it('keeps owned catalog references', () => {
    expect(
      applyOwnedCatalogMetadata(
        { productId: 'prod-a', variantId: 'var-a' },
        {
          productIds: new Set(['prod-a']),
          variantIds: new Set(['var-a']),
        }
      )
    ).toEqual({ productId: 'prod-a', variantId: 'var-a' })
  })
})

describe('loadOwnedCatalogRefs', () => {
  it('throws before querying when accountId is missing', async () => {
    const from = vi.fn()
    await expect(
      loadOwnedCatalogRefs({ from } as never, '', {
        productIds: ['prod-a'],
        variantIds: [],
      })
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    expect(from).not.toHaveBeenCalled()
  })

  it('scopes product and variant lookups to the session account', async () => {
    const productEq = vi.fn()
    const productIn = vi.fn()
    const variantEq = vi.fn()
    const variantIn = vi.fn()
    const from = vi.fn((table: string) => {
      if (table === 'catalog_products') {
        const query = {
          select: () => query,
          eq: (...args: unknown[]) => {
            productEq(...args)
            return query
          },
          in: (...args: unknown[]) => {
            productIn(...args)
            return Promise.resolve({
              data: [{ id: 'prod-a' }],
              error: null,
            })
          },
        }
        return query
      }
      const query = {
        select: () => query,
        eq: (...args: unknown[]) => {
          variantEq(...args)
          return query
        },
        in: (...args: unknown[]) => {
          variantIn(...args)
          return Promise.resolve({
            data: [{ id: 'var-foreign' }],
            error: null,
          })
        },
      }
      return query
    })

    const owned = await loadOwnedCatalogRefs({ from } as never, 'acct-a', {
      productIds: ['prod-a', 'prod-b'],
      variantIds: ['var-foreign'],
    })
    expect(productEq).toHaveBeenCalledWith('account_id', 'acct-a')
    expect(variantEq).toHaveBeenCalledWith('account_id', 'acct-a')
    expect(productIn).toHaveBeenCalledWith('id', ['prod-a', 'prod-b'])
    expect(owned.productIds.has('prod-a')).toBe(true)
    expect(owned.productIds.has('prod-b')).toBe(false)
  })
})
