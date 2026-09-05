import { describe, expect, it } from 'vitest'

import {
  canonicalizeUrl,
  extractPageTitle,
  extractSameHostLinks,
  isBlockedHostname,
  isHomepageUrl,
  isPrivateIp,
  parsePublicHttpUrl,
  prioritizeKnowledgeLinks,
  scrapeModeForUrl,
} from './scrape'
import { extractHttpUrl } from './scrape-url'
import { AiError } from './types'

describe('extractHttpUrl', () => {
  it('accepts a whole-string URL', () => {
    expect(extractHttpUrl('https://store.example.com/pages/faq')).toBe(
      'https://store.example.com/pages/faq',
    )
  })

  it('pulls the first URL out of pasted text', () => {
    expect(extractHttpUrl('See https://shop.example.com/products/hat now')).toBe(
      'https://shop.example.com/products/hat',
    )
  })

  it('strips trailing punctuation', () => {
    expect(extractHttpUrl('https://example.com/about.')).toBe('https://example.com/about')
  })

  it('rejects non-http text', () => {
    expect(extractHttpUrl('returns policy')).toBeNull()
    expect(extractHttpUrl('ftp://example.com')).toBeNull()
  })
})

describe('parsePublicHttpUrl / SSRF deny list', () => {
  it('accepts a public https URL', () => {
    const url = parsePublicHttpUrl('https://www.example.com/products/mug')
    expect(url.hostname).toBe('www.example.com')
  })

  it('blocks localhost and private hosts', () => {
    const blocked = [
      'http://localhost/admin',
      'http://127.0.0.1/',
      'http://10.0.0.8/secret',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/',
      'http://thing.local/page',
    ]
    for (const raw of blocked) {
      expect(() => parsePublicHttpUrl(raw), raw).toThrow(AiError)
    }
  })

  it('blocks private IPv4 literals', () => {
    expect(isPrivateIp('10.1.2.3')).toBe(true)
    expect(isPrivateIp('172.16.0.1')).toBe(true)
    expect(isPrivateIp('192.168.0.9')).toBe(true)
    expect(isPrivateIp('127.0.0.1')).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('example.com')).toBe(false)
  })
})

describe('homepage vs deep page mode', () => {
  it('treats roots and shop homes as site crawls', () => {
    expect(scrapeModeForUrl(new URL('https://shop.example.com/'))).toBe('site')
    expect(scrapeModeForUrl(new URL('https://shop.example.com/en'))).toBe('site')
    expect(scrapeModeForUrl(new URL('https://shop.example.com/shop'))).toBe('site')
    expect(isHomepageUrl(new URL('https://shop.example.com/'))).toBe(true)
  })

  it('treats product and blog URLs as page mode', () => {
    expect(scrapeModeForUrl(new URL('https://shop.example.com/products/hat'))).toBe(
      'page',
    )
    expect(scrapeModeForUrl(new URL('https://shop.example.com/blogs/news/hello'))).toBe(
      'page',
    )
  })
})

describe('HTML extract + same-host links', () => {
  const html = `
    <html><head>
      <title>  Shipping policy </title>
      <meta property="og:title" content="Ship times" />
    </head>
    <body>
      <a href="/products/hat">Hat</a>
      <a href="https://shop.example.com/pages/faq">FAQ</a>
      <a href="https://other.com/about">Other</a>
      <a href="/cart">Cart</a>
      <a href="/hat.jpg">Image</a>
      <a href="mailto:hi@example.com">Mail</a>
    </body></html>
  `
  const page = new URL('https://shop.example.com/pages/shipping')

  it('prefers og:title', () => {
    expect(extractPageTitle(html)).toBe('Ship times')
  })

  it('keeps same-host content links and drops cart/assets/external', () => {
    const links = extractSameHostLinks(html, page)
    expect(links).toContain('https://shop.example.com/products/hat')
    expect(links).toContain('https://shop.example.com/pages/faq')
    expect(links.some((l) => l.includes('/cart'))).toBe(false)
    expect(links.some((l) => l.includes('other.com'))).toBe(false)
  })

  it('ranks product/blog/page paths first', () => {
    const ranked = prioritizeKnowledgeLinks([
      'https://shop.example.com/random',
      'https://shop.example.com/products/hat',
      'https://shop.example.com/blogs/news',
    ])
    expect(ranked[0]).toContain('/products/hat')
    expect(ranked[1]).toContain('/blogs/news')
  })

  it('canonicalizes trailing slashes', () => {
    expect(canonicalizeUrl(new URL('https://Shop.Example.com/pages/faq/'))).toBe(
      'https://shop.example.com/pages/faq',
    )
  })
})
