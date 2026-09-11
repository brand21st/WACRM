import { describe, expect, it } from 'vitest';

import {
  catalogHandleCandidates,
  isCatalogProductCardText,
  parseCatalogProductCard,
} from './parse-catalog-product-card';

describe('parseCatalogProductCard', () => {
  it('parses compare pricing and inline variants', () => {
    const result = parseCatalogProductCard(
      [
        'Vatican coord set✨ AG2637 ✨',
        '~710~ 544.7–670 INR',
        'Stock in Variants: XL',
        'Color: Purple',
        'View: https://samanga.in/products/vatican-coord-set✨ag2637✨',
      ].join('\n'),
    );

    expect(result).toEqual({
      title: 'Vatican coord set✨ AG2637 ✨',
      priceLine: '~710~ 544.7–670 INR',
      stockLine: 'Stock in',
      variantsLine: 'Variants: XL',
      colorLine: 'Color: Purple',
      viewUrl: 'https://samanga.in/products/vatican-coord-set✨ag2637',
      handle: 'vatican-coord-set✨ag2637',
    });
  });

  it('parses variants on their own line', () => {
    const result = parseCatalogProductCard(
      [
        'Red Leather Tote',
        '49.00–69.00 USD',
        'Stock in',
        'Variants: S',
        'Color: Red',
        'View: https://shop.example/products/red-leather-tote',
      ].join('\n'),
    );

    expect(result?.priceLine).toBe('49.00–69.00 USD');
    expect(result?.variantsLine).toBe('Variants: S');
    expect(result?.handle).toBe('red-leather-tote');
  });

  it('does not classify ordinary messages as product cards', () => {
    expect(isCatalogProductCardText('We have this in purple.')).toBe(false);
    expect(parseCatalogProductCard('We have this in purple.')).toBeNull();
  });

  it('provides a clean handle before decorative caption text', () => {
    expect(
      catalogHandleCandidates(
        'https://samanga.in/products/vatican-coord-set✨ag2637✨',
      ),
    ).toEqual([
      'vatican-coord-set✨ag2637✨',
      'vatican-coord-set',
      'vatican-coord-set-ag2637',
    ]);
  });

  it('keeps the full product slug when the handle contains decorative separators', () => {
    expect(
      catalogHandleCandidates(
        'https://samanga.in/products/vatican-silk-side-slit-✨ag2655✨',
      ),
    ).toEqual([
      'vatican-silk-side-slit-✨ag2655✨',
      'vatican-silk-side-slit',
      'vatican-silk-side-slit-ag2655',
    ]);
  });
});
