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

const ASK_STOP = new Set([
  ...STOP,
  'show',
  'send',
  'give',
  'me',
  'please',
  'want',
  'need',
  'looking',
  'have',
  'you',
  'do',
  'can',
  'just',
  'one',
  'some',
  'few',
  'option',
  'options',
  'products',
  'items',
  'cards',
  'something',
  'there',
  'here',
  'any',
  'your',
  'our',
  'got',
  'get',
  'find',
  'see',
  'check',
  'available',
  'stock',
  'price',
  'cost',
  'how',
  'much',
  'many',
  'what',
  'which',
  'where',
  'is',
  'are',
  'buy',
  'order',
  'link',
  'hello',
  'hi',
  'recommend',
  'recommendation',
  'recommendations',
  'suggest',
  'suggestion',
  'suggestions',
  'should',
  'wanna',
  'gonna',
  'thanks',
  'thank',
])

export function tokensFromDescription(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t))
}

export function productAskTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !ASK_STOP.has(t))
}

export function productSearchQuery(text: string): string {
  return productAskTokens(text).join(' ')
}

function tokenVariants(token: string): string[] {
  const out = [token]
  if (token.endsWith('ies') && token.length > 4) out.push(`${token.slice(0, -3)}y`)
  else if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    out.push(token.slice(0, -1))
  }
  return out
}

function hayHasToken(hay: string, token: string): boolean {
  return tokenVariants(token).some((t) => hay.includes(t))
}

function productMatchHay(product: ShopifyProductHit): {
  title: string
  handle: string
  sku: string
  hay: string
} {
  const title = product.title.toLowerCase()
  const handle = product.handle.replace(/-/g, ' ').toLowerCase()
  const sku = product.variants.map((v) => (v.sku ?? '').toLowerCase()).join(' ')
  const options = product.variants
    .flatMap((v) => [v.title, ...v.options.map((o) => o.value)])
    .join(' ')
    .toLowerCase()
  return { title, handle, sku, hay: `${title} ${handle} ${sku} ${options}` }
}

/**
 * Keep catalog hits that match what the customer named (title, handle, SKU,
 * or variant). Drops unrelated search noise. Does not invent products.
 */
export function matchProductsToAsk(
  query: string,
  products: ShopifyProductHit[],
  limit: number,
): ShopifyProductHit[] {
  if (products.length === 0) return []
  const tokens = productAskTokens(query)
  if (tokens.length === 0) return products.slice(0, limit)

  const phrase = tokens.join(' ')
  const scored = products.map((p) => {
    const fields = productMatchHay(p)
    let score = 0
    let allHit = true
    for (const token of tokens) {
      if (hayHasToken(fields.title, token)) score += 3
      else if (hayHasToken(fields.handle, token) || hayHasToken(fields.sku, token)) {
        score += 2
      } else if (hayHasToken(fields.hay, token)) score += 1
      else allHit = false
    }
    const phraseHit =
      hayHasToken(fields.title, phrase) ||
      fields.title.includes(phrase) ||
      fields.handle.includes(phrase) ||
      fields.sku.includes(phrase)
    if (phraseHit) score += 10
    return { p, score, allHit, phraseHit }
  })

  const keep = scored
    .filter((s) => s.score > 0 && (s.phraseHit || s.allHit))
    .sort((a, b) => b.score - a.score)
  return keep.slice(0, limit).map((s) => s.p)
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
