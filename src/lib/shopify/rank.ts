import type { ShopifyProductHit } from './types'

const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'in',
  'on',
  'with',
  'for',
  'this',
  'that',
  'from',
  'photo',
  'image',
  'picture',
  'customer',
  'sent',
  'looks',
  'like',
  'item',
  'product',
])

export function tokensFromDescription(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t))
}

export function scoreProductAgainstDescription(
  product: ShopifyProductHit,
  tokens: string[],
): number {
  const title = product.title.toLowerCase()
  const hay = [
    product.title,
    product.handle.replace(/-/g, ' '),
    product.description,
    ...product.variants.flatMap((v) => [
      v.title,
      v.sku ?? '',
      ...v.options.map((o) => `${o.name} ${o.value}`),
    ]),
  ]
    .join(' ')
    .toLowerCase()

  let score = 0
  for (const token of tokens) {
    if (title.includes(token)) score += 3
    else if (hay.includes(token)) score += 1
  }
  return score
}

/**
 * Rank catalog hits against a vision description. Returns a single
 * product when the top score is clearly ahead; otherwise the closest
 * 2–3. Never invents products that were not already in `products`.
 */
export function rankProductsByDescription(
  description: string,
  products: ShopifyProductHit[],
): ShopifyProductHit[] {
  if (products.length === 0) return []
  const tokens = tokensFromDescription(description)
  const scored = products
    .map((p) => ({ p, score: scoreProductAgainstDescription(p, tokens) }))
    .sort((a, b) => b.score - a.score)
  const top = scored[0]
  const second = scored[1]
  if (!top || top.score <= 0) return products.slice(0, 3)
  if (!second || (top.score >= 4 && top.score >= Math.max(2, second.score * 2))) {
    return [top.p]
  }
  return scored
    .filter((s) => s.score > 0)
    .slice(0, 3)
    .map((s) => s.p)
}
