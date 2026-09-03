import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { InteractivePreview } from './interactive-preview'

describe('InteractivePreview', () => {
  it('renders WhatsApp ~strikethrough~ in the body as <s>', () => {
    const html = renderToStaticMarkup(
      React.createElement(InteractivePreview, {
        payload: {
          kind: 'cta_url',
          body: 'Tote\n~69.00~ 49.00 USD',
          display_text: 'Checkout NOW',
          url: 'https://shop.example/cart/1:1?checkout',
        },
      }),
    )
    expect(html).toContain('<s>69.00</s>')
    expect(html).toContain('49.00 USD')
    expect(html).not.toContain('~69.00~')
  })

  it('renders a View cart CTA label', () => {
    const html = renderToStaticMarkup(
      React.createElement(InteractivePreview, {
        payload: {
          kind: 'cta_url',
          body: 'Red Bag — 49 USD',
          display_text: 'View cart',
          url: 'https://shop.example/cart/99:1',
        },
      }),
    )
    expect(html).toContain('View cart')
    expect(html).toContain('Red Bag — 49 USD')
  })

  it('renders a native product_list', () => {
    const html = renderToStaticMarkup(
      React.createElement(InteractivePreview, {
        payload: {
          kind: 'product_list',
          header: 'Products',
          body: 'Red Bag',
          catalog_id: '111',
          product_retailer_ids: ['BAG-RED'],
        },
      }),
    )
    expect(html).toContain('Products')
    expect(html).toContain('View product')
  })
})
