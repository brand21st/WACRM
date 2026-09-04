export const MIN_PRODUCT_CARDS = 1
export const MAX_PRODUCT_CARDS = 10
export const DEFAULT_SEARCH_CARDS = 3
export const BROWSE_PRODUCT_CARDS = 10

const BROWSE_ALL =
  /\b(new products?|new arrivals?|best[- ]?sell(?:ing|ers?)|bestsellers?|trending|popular products?|wacrm:products)\b/i

const RECOMMEND =
  /\b(recommend(?:ation)?s?|suggest(?:ions?)?|for me|what should i buy|something for me)\b/i

const FEW_OPTIONS = /\b(some|few|options?|a couple|a few)\b/i

const ONE_ITEM =
  /\b(this one|that one|the one|just (?:this|that|one)|only one|this product|that product)\b/i

const SKU_LIKE = /\b[A-Z]{2,}[-_][A-Z0-9]{2,}\b/

const SEND_THE_ONE =
  /\b(?:send|show|give)\s+(?:me\s+)?(?:the|this|that)\s+[a-z][\w\s-]{0,40}?\b(?!s\b)/i

function clampCardCount(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_CARDS
  return Math.min(MAX_PRODUCT_CARDS, Math.max(MIN_PRODUCT_CARDS, Math.floor(n)))
}

function lastContentWord(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .trim()
    .split(/\s+/)
  return words[words.length - 1] ?? ''
}

function looksSingularProductAsk(text: string): boolean {
  if (ONE_ITEM.test(text) || SKU_LIKE.test(text)) return true
  if (/\b(bags|sarees|products|items|options|ones)\b/i.test(text)) return false
  if (SEND_THE_ONE.test(text)) {
    const last = lastContentWord(text)
    return Boolean(last) && !last.endsWith('s')
  }
  return false
}

function explicitCount(text: string): number | null {
  const match = text.match(
    /\b(?:show|send|give|list|need|want|get)?\s*(?:me\s+)?(\d{1,2})\s*(?:products?|items?|cards?|options?|pcs?|pieces?)?\b/i,
  )
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n) || n < 1) return null
  return clampCardCount(n)
}

/**
 * How many Shopify product cards this customer message should get.
 * Tool `limit` overrides this when the model sets it.
 */
export function inferProductCardLimit(text: string): number {
  const raw = text.replace(/\s+/g, ' ').trim()
  if (!raw) return DEFAULT_SEARCH_CARDS

  const numbered = explicitCount(raw)
  if (numbered != null) return numbered

  if (BROWSE_ALL.test(raw)) return BROWSE_PRODUCT_CARDS
  if (RECOMMEND.test(raw) || FEW_OPTIONS.test(raw)) return DEFAULT_SEARCH_CARDS
  if (looksSingularProductAsk(raw)) return MIN_PRODUCT_CARDS
  return DEFAULT_SEARCH_CARDS
}

export function resolveProductCardLimit(
  requested: unknown,
  customerText: string | null | undefined,
): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) {
    return clampCardCount(requested)
  }
  if (typeof requested === 'string' && requested.trim()) {
    const n = Number(requested)
    if (Number.isFinite(n)) return clampCardCount(n)
  }
  return inferProductCardLimit(customerText ?? '')
}
