import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { formatCartMoney } from '@/lib/commerce/inbound-order'
import {
  InboundCartCard,
  InteractivePreview,
  splitCartLineName,
} from './interactive-preview'

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

  it('renders a full cart card with name, qty, prices, and total', () => {
    const html = renderToStaticMarkup(
      React.createElement(InteractivePreview, {
        payload: {
          kind: 'inbound_order',
          items: [
            {
              product_retailer_id: 'BAG-RED',
              quantity: 2,
              name: 'Red Bag',
              item_price: 49,
              currency: 'INR',
              image_url: 'https://cdn.example/red-bag.jpg',
            },
            {
              product_retailer_id: 'TOTE',
              quantity: 1,
              name: 'Canvas Tote',
              item_price: 20,
              currency: 'INR',
            },
          ],
        },
      }),
    )
    expect(html).toContain('3 items')
    expect(html).toContain('Red Bag')
    expect(html).toContain('Canvas Tote')
    expect(html).toContain('Qty 2')
    expect(html).toContain(formatCartMoney(49, 'INR'))
    expect(html).toContain(formatCartMoney(98, 'INR'))
    expect(html).toContain('Total')
    expect(html).toContain(formatCartMoney(118, 'INR'))
    expect(html).not.toContain('BAG-RED')
    expect(html).toContain('https://cdn.example/red-bag.jpg')
  })

  it('shows compare-at when the stored cart price is a ₹1 stub', () => {
    const html = renderToStaticMarkup(
      React.createElement(InboundCartCard, {
        items: [
          {
            product_retailer_id: '47869262004382',
            quantity: 1,
            name: 'Rayon Aline kurti',
            item_price: 1,
            compare_at_price: 508,
            currency: 'INR',
          },
        ],
      }),
    )
    expect(html).toContain(formatCartMoney(508, 'INR'))
    expect(html).not.toContain(formatCartMoney(1, 'INR'))
  })

  it('puts the variant on its own line so the title can use the row width', () => {
    const html = renderToStaticMarkup(
      React.createElement(InboundCartCard, {
        items: [
          {
            product_retailer_id: 'AG2660',
            quantity: 1,
            name: 'Rayon side slit Coord sets ✨AG2660✨ — Light Yellow / L / Rayon',
            item_price: 544.7,
            compare_at_price: 655,
            currency: 'INR',
            image_url: 'https://cdn.example/coord.jpg',
          },
        ],
      }),
    )
    expect(html).toContain('Rayon side slit Coord sets ✨AG2660✨')
    expect(html).toContain('Light Yellow / L / Rayon')
    expect(html).toContain('line-clamp-2')
    expect(html).toContain(formatCartMoney(544.7, 'INR'))
    expect(html).toContain(formatCartMoney(655, 'INR'))
  })

  it('falls back to the retailer id when the name is unknown', () => {
    const html = renderToStaticMarkup(
      React.createElement(InboundCartCard, {
        items: [{ product_retailer_id: '48218084933790', quantity: 1 }],
      }),
    )
    expect(html).toContain('48218084933790')
    expect(html).toContain('1 item')
    expect(html).toContain('Qty 1')
    expect(html).not.toContain('Total')
  })
})

describe('splitCartLineName', () => {
  it('splits a catalog title from the variant', () => {
    expect(
      splitCartLineName(
        'Rayon side slit Coord sets ✨AG2660✨ — Light Yellow / L / Rayon',
      ),
    ).toEqual({
      title: 'Rayon side slit Coord sets ✨AG2660✨',
      variant: 'Light Yellow / L / Rayon',
    })
  })

  it('keeps a name without a variant intact', () => {
    expect(splitCartLineName('Red Bag')).toEqual({ title: 'Red Bag' })
  })
})

