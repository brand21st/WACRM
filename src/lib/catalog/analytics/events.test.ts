import { describe, expect, it } from 'vitest';
import { createCatalogMemoryDb } from '../search/memory-db';
import { recordCatalogLineEvents, recordCatalogProductEvents } from './events';
import {
  catalogAnalyticsSince,
  loadCatalogAnalyticsDashboard,
  parseCatalogAnalyticsRange,
} from './aggregate';

describe('catalog analytics events', () => {
  it('does not write when the flag is off', async () => {
    const db = createCatalogMemoryDb({
      ai_configs: [{ account_id: 'acct-a', catalog_analytics: 'off' }],
      catalog_products: [
        {
          id: 'p1',
          account_id: 'acct-a',
          handle: 'saree',
          title: 'Saree',
          status: 'active',
        },
      ],
    });
    await recordCatalogProductEvents(db, {
      accountId: 'acct-a',
      event: 'search_match',
      source: 'search_products',
      productIds: ['p1', 'Invented Bridal Lehenga'],
    });
    const { data } = await db.from('catalog_product_events').select();
    expect(data).toEqual([]);
  });

  it('stores only real catalog ids and skips invented titles', async () => {
    const db = createCatalogMemoryDb({
      ai_configs: [{ account_id: 'acct-a', catalog_analytics: 'on' }],
      catalog_products: [
        {
          id: 'p1',
          account_id: 'acct-a',
          handle: 'saree',
          title: 'Black Wedding Saree',
          status: 'active',
        },
      ],
    });
    await recordCatalogProductEvents(db, {
      accountId: 'acct-a',
      event: 'search_match',
      source: 'search_products',
      productIds: ['p1', 'Invented Bridal Lehenga'],
    });
    const { data } = await db.from('catalog_product_events').select();
    expect(data).toEqual([
      expect.objectContaining({
        product_id: 'p1',
        event: 'search_match',
        account_id: 'acct-a',
      }),
    ]);
  });

  it('does not leak another account product id', async () => {
    const db = createCatalogMemoryDb({
      ai_configs: [{ account_id: 'acct-a', catalog_analytics: 'on' }],
      catalog_products: [
        {
          id: 'p-b',
          account_id: 'acct-b',
          handle: 'other',
          title: 'Other',
          status: 'active',
        },
      ],
    });
    await recordCatalogProductEvents(db, {
      accountId: 'acct-a',
      event: 'shown',
      source: 'card_send',
      productIds: ['p-b'],
    });
    const { data } = await db.from('catalog_product_events').select();
    expect(data).toEqual([]);
  });

  it('attributes add-to-cart and purchase through retailer_id', async () => {
    const db = createCatalogMemoryDb({
      ai_configs: [{ account_id: 'acct-a', catalog_analytics: 'on' }],
      catalog_products: [
        {
          id: 'p1',
          account_id: 'acct-a',
          handle: 'saree',
          title: 'Saree',
          status: 'active',
        },
      ],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Default',
          retailer_id: 'SAREE-BLK',
          available: true,
        },
      ],
    });
    await recordCatalogLineEvents(db, {
      accountId: 'acct-a',
      event: 'add_to_cart',
      lines: [
        { retailer_id: 'SAREE-BLK', quantity: 2 },
        { retailer_id: 'UNKNOWN', quantity: 1 },
      ],
    });
    const { data } = await db.from('catalog_product_events').select();
    expect(data).toEqual([
      expect.objectContaining({
        product_id: 'p1',
        variant_id: 'v1',
        event: 'add_to_cart',
        quantity: 2,
      }),
    ]);
  });

  it('deduplicates a replayed commerce outcome by trusted source id', async () => {
    const db = createCatalogMemoryDb({
      ai_configs: [{ account_id: 'acct-a', catalog_analytics: 'on' }],
      catalog_products: [
        {
          id: 'p1',
          account_id: 'acct-a',
          handle: 'saree',
          title: 'Saree',
          status: 'active',
        },
      ],
    });
    const input = {
      accountId: 'acct-a',
      event: 'purchase' as const,
      source: 'whatsapp_order' as const,
      productIds: ['p1'],
      sourceEventId: 'order-1',
    };
    await recordCatalogProductEvents(db, input);
    await recordCatalogProductEvents(db, input);
    const { data } = await db.from('catalog_product_events').select();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.idempotency_key).toBe(
      'whatsapp_order:order-1:purchase:p1:none'
    );
  });
});

describe('catalog analytics aggregation', () => {
  it('parses ranges and groups counts', async () => {
    expect(parseCatalogAnalyticsRange('today')).toBe('today');
    expect(parseCatalogAnalyticsRange('nope')).toBe('7d');
    const now = new Date('2026-09-08T12:00:00.000Z');
    expect(catalogAnalyticsSince('today', now).toISOString()).toBe(
      '2026-09-08T00:00:00.000Z'
    );

    const recent = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000
    ).toISOString();
    const db = createCatalogMemoryDb({
      catalog_products: [
        {
          id: 'p1',
          account_id: 'acct-a',
          handle: 'saree',
          title: 'Black Wedding Saree',
          status: 'active',
        },
      ],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          available: false,
          inventory_quantity: 0,
        },
      ],
      catalog_product_events: [
        {
          account_id: 'acct-a',
          product_id: 'p1',
          event: 'search_match',
          quantity: 3,
          created_at: recent,
        },
        {
          account_id: 'acct-b',
          product_id: 'p1',
          event: 'search_match',
          quantity: 99,
          created_at: recent,
        },
      ],
    });
    const dashboard = await loadCatalogAnalyticsDashboard(db, 'acct-a', '30d');
    expect(dashboard.overview.totalProducts).toBe(1);
    expect(dashboard.overview.outOfStockProducts).toBe(1);
    expect(dashboard.overview.productsAsked).toBe(1);
    expect(dashboard.topAsked[0]?.title).toBe('Black Wedding Saree');
    expect(dashboard.topAsked[0]?.asked).toBe(3);

    const today = await loadCatalogAnalyticsDashboard(db, 'acct-a', 'today');
    expect(today.overview.productsAsked).toBe(0);
    expect(today.topAsked).toEqual([]);
  });

  it('returns empty rankings when there are no events', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [],
    });
    const dashboard = await loadCatalogAnalyticsDashboard(db, 'acct-a', '7d');
    expect(dashboard.overview.totalProducts).toBe(0);
    expect(dashboard.topAsked).toEqual([]);
    expect(dashboard.products).toEqual([]);
  });
});
