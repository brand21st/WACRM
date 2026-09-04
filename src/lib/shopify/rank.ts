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
  'under',
  'below',
  'within',
  'budget',
  'budgetil',
  'upto',
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
  return productAskTokens(stripBudgetPhrases(text)).join(' ')
}

export type PriceBudget = { min?: number; max?: number }

export function parseBudget(text: string | null | undefined): PriceBudget | null {
  const raw = (text ?? '').replace(/,/g, '')
  if (!raw.trim()) return null
  const range = raw.match(
    /(?:rs\.?|₹|inr)?\s*(\d{2,7})\s*(?:-|to|–)\s*(?:rs\.?|₹|inr)?\s*(\d{2,7})/i,
  )
  if (range) {
    const min = Number(range[1])
    const max = Number(range[2])
    if (Number.isFinite(min) && Number.isFinite(max) && max >= min) {
      return { min, max }
    }
  }
  const under = raw.match(
    /\b(?:under|below|within|max(?:imum)?|upto|up to|budget(?:il)?)\s*(?:is|aanu|=|:)?\s*(?:rs\.?|₹|inr)?\s*(\d{2,7})\b/i,
  )
  if (under) {
    const max = Number(under[1])
    if (Number.isFinite(max)) return { max }
  }
  return null
}

export function parsePriceArg(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.replace(/[,₹]/g, ''))
    if (Number.isFinite(n) && n > 0) return n
  }
  return undefined
}

export function productUnitPrice(product: ShopifyProductHit): number | null {
  const n = Number(product.priceMin)
  return Number.isFinite(n) ? n : null
}

export function filterByBudget(
  products: ShopifyProductHit[],
  budget: PriceBudget | null | undefined,
): ShopifyProductHit[] {
  if (!budget || (budget.min == null && budget.max == null)) return products
  return products.filter((p) => {
    const price = productUnitPrice(p)
    if (price == null) return false
    if (budget.min != null && price < budget.min) return false
    if (budget.max != null && price > budget.max) return false
    return true
  })
}

function stripBudgetPhrases(text: string): string {
  return text
    .replace(/,/g, '')
    .replace(
      /\b(?:under|below|within|max(?:imum)?|upto|up to|budget(?:il)?)\s*(?:is|aanu|=|:)?\s*(?:rs\.?|₹|inr)?\s*\d{2,7}\b/gi,
      ' ',
    )
    .replace(/(?:rs\.?|₹|inr)\s*\d{2,7}/gi, ' ')
    .replace(/\b\d{2,7}\s*(?:-|to|–)\s*\d{2,7}\b/gi, ' ')
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
export type ShoppingMatch = {
  hits: ShopifyProductHit[]
  exact: boolean
}

function scoreAskHits(query: string, products: ShopifyProductHit[]) {
  const tokens = productAskTokens(query)
  const phrase = tokens.join(' ')
  return products.map((p) => {
    const fields = productMatchHay(p)
    let score = 0
    let allHit = tokens.length > 0
    for (const token of tokens) {
      if (hayHasToken(fields.title, token)) score += 3
      else if (hayHasToken(fields.handle, token) || hayHasToken(fields.sku, token)) {
        score += 2
      } else if (hayHasToken(fields.hay, token)) score += 1
      else allHit = false
    }
    const phraseHit =
      Boolean(phrase) &&
      (hayHasToken(fields.title, phrase) ||
        fields.title.includes(phrase) ||
        fields.handle.includes(phrase) ||
        fields.sku.includes(phrase))
    if (phraseHit) score += 10
    return { p, score, allHit, phraseHit }
  })
}

export function rankShoppingProducts(
  query: string,
  products: ShopifyProductHit[],
  limit: number,
): ShoppingMatch {
  if (products.length === 0) return { hits: [], exact: false }
  const tokens = productAskTokens(query)
  if (tokens.length === 0) {
    return { hits: products.slice(0, limit), exact: true }
  }
  const scored = scoreAskHits(query, products).sort((a, b) => b.score - a.score)
  const exact = scored.filter((s) => s.score > 0 && (s.phraseHit || s.allHit))
  if (exact.length > 0) {
    return { hits: exact.slice(0, limit).map((s) => s.p), exact: true }
  }
  const close = scored.filter((s) => s.score > 0).slice(0, limit)
  return { hits: close.map((s) => s.p), exact: false }
}

export function matchProductsToAsk(
  query: string,
  products: ShopifyProductHit[],
  limit: number,
  opts?: { allowCloseAlternatives?: boolean },
): ShopifyProductHit[] {
  if (opts?.allowCloseAlternatives) {
    return rankShoppingProducts(query, products, limit).hits
  }
  if (products.length === 0) return []
  const tokens = productAskTokens(query)
  if (tokens.length === 0) return products.slice(0, limit)
  return scoreAskHits(query, products)
    .filter((s) => s.score > 0 && (s.phraseHit || s.allHit))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.p)
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
