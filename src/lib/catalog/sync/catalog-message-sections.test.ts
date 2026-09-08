import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import {
  allocateCollectionSections,
  buildCatalogCollectionSections,
  isCustomerFacingCollection,
  PRODUCT_LIST_LIMITS,
} from './catalog-message-sections'

describe('isCustomerFacingCollection', () => {
  it('hides Shopify homepage and test collections', () => {
    expect(isCustomerFacingCollection({ handle: 'frontpage', title: 'Home page' })).toBe(
      false,
    )
    expect(isCustomerFacingCollection({ handle: 'test-0021', title: 'test 0021' })).toBe(
      false,
    )
    expect(isCustomerFacingCollection({ handle: 'kurti', title: 'Kurti' })).toBe(true)
  })
})

describe('allocateCollectionSections', () => {
  it('names sections after collections and round-robins the 30-item cap', () => {
    const sections = allocateCollectionSections(
      [
        { title: 'Kurti', retailerIds: ['k1', 'k2', 'k3'] },
        { title: 'Co-Ord Set', retailerIds: ['c1', 'c2'] },
        { title: 'Party Wear', retailerIds: ['p1'] },
      ],
      { maxSections: 10, maxItems: 4, titleMax: 24 },
    )
    expect(sections).toEqual([
      { title: 'Kurti', productRetailerIds: ['k1', 'k2'] },
      { title: 'Co-Ord Set', productRetailerIds: ['c1'] },
      { title: 'Party Wear', productRetailerIds: ['p1'] },
    ])
  })

  it('clips titles and drops empty collections', () => {
    const sections = allocateCollectionSections([
      { title: 'Office wear collections extra', retailerIds: ['o1'] },
      { title: 'Empty', retailerIds: [] },
    ])
    expect(sections).toEqual([
      {
        title: 'Office wear collections extra'
          .slice(0, PRODUCT_LIST_LIMITS.titleMax)
          .trim(),
        productRetailerIds: ['o1'],
      },
    ])
  })
})

describe('buildCatalogCollectionSections', () => {
  it('uses one in-stock retailer id per product and skips homepage', async () => {
    const db = createCatalogMemoryDb({
      catalog_collections: [
        {
          id: 'col-home',
          account_id: 'acct',
          handle: 'frontpage',
          title: 'Home page',
          status: 'active',
        },
        {
          id: 'col-kurti',
          account_id: 'acct',
          handle: 'kurti',
          title: 'Kurti',
          status: 'active',
        },
      ],
      catalog_product_collections: [
        {
          account_id: 'acct',
          collection_id: 'col-home',
          product_id: 'p1',
          sort_order: 0,
        },
        {
          account_id: 'acct',
          collection_id: 'col-kurti',
          product_id: 'p1',
          sort_order: 0,
        },
        {
          account_id: 'acct',
          collection_id: 'col-kurti',
          product_id: 'p2',
          sort_order: 1,
        },
      ],
      catalog_products: [
        { id: 'p1', account_id: 'acct', status: 'active' },
        { id: 'p2', account_id: 'acct', status: 'active' },
      ],
      catalog_variants: [
        {
          product_id: 'p1',
          account_id: 'acct',
          retailer_id: 'P1-OS',
          available: false,
        },
        {
          product_id: 'p1',
          account_id: 'acct',
          retailer_id: 'P1-IN',
          available: true,
        },
        {
          product_id: 'p2',
          account_id: 'acct',
          retailer_id: 'P2-IN',
          available: true,
        },
      ],
    })

    const sections = await buildCatalogCollectionSections(db, 'acct')
    expect(sections).toEqual([
      { title: 'Kurti', productRetailerIds: ['P1-IN', 'P2-IN'] },
    ])
  })
})
