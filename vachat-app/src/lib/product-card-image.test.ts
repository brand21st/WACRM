import { describe, expect, it } from 'vitest';

import { productCardImageUrl } from './product-card-image';

describe('productCardImageUrl', () => {
  it('uses media_url for image messages', () => {
    expect(
      productCardImageUrl({
        content_type: 'image',
        media_url: 'https://cdn.example/photo.jpg',
      }),
    ).toBe('https://cdn.example/photo.jpg');
  });

  it('uses interactive header_image for checkout product cards', () => {
    expect(
      productCardImageUrl({
        content_type: 'interactive',
        interactive_payload: {
          kind: 'cta_url',
          header_image:
            'https://cdn.shopify.com/s/files/1/0708/8393/4366/files/product.jpg?v=1779953784',
        },
      }),
    ).toBe(
      'https://cdn.shopify.com/s/files/1/0708/8393/4366/files/product.jpg?v=1779953784',
    );
  });

  it('returns undefined when no product image is available', () => {
    expect(
      productCardImageUrl({
        content_type: 'interactive',
        interactive_payload: { kind: 'buttons', body: 'Choose one' },
      }),
    ).toBeUndefined();
  });
});
