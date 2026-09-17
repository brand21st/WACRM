/**
 * Merchant-agnostic product-ask tokenization.
 * Used by catalog recall (FTS / ILIKE) and shopping rank.
 */

const ASK_STOP = new Set([
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
  'related',
  'similar',
  'matching',
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
  'would',
  'could',
  'to',
  'know',
  'about',
  'tell',
  'info',
  'information',
  'details',
  'interested',
  'enquire',
  'inquiry',
  'asking',
  'regarding',
  'pls',
  'plz',
  'help',
  'we',
  'us',
  'im',
])

/** Category modifiers — score them, but do not require them in the title. */
const WEAK_ASK = new Set([
  'toy',
  'toys',
  'kid',
  'kids',
  'baby',
  'babies',
  'child',
  'children',
  'set',
  'kit',
  'mini',
  'little',
  'cute',
])

export function compactText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export function isWeakAskToken(token: string): boolean {
  return WEAK_ASK.has(token)
}

export function productAskTokens(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
  const raw: string[] = []
  for (const part of cleaned.split(/\s+/).filter(Boolean)) {
    const compact = part.replace(/-+/g, '')
    if (compact.length >= 2 && !ASK_STOP.has(compact)) raw.push(compact)
    if (part.includes('-')) {
      for (const sub of part.split('-')) {
        if (sub.length >= 2 && !ASK_STOP.has(sub)) raw.push(sub)
      }
    }
  }
  return uniqueTokens(raw)
}

export function productFtsTokens(text: string): string[] {
  return productAskTokens(text).filter((t) => t.length >= 3)
}

export function requiredAskTokens(text: string): string[] {
  const tokens = productFtsTokens(text)
  const required = tokens.filter((t) => !isWeakAskToken(t))
  return required.length > 0 ? required : tokens
}

/** websearch AND of every meaningful token. */
export function catalogFtsAndQuery(raw: string): string {
  return joinFts(productFtsTokens(raw))
}

/** websearch AND of the non-modifier tokens (“toy camera” → camera). */
export function catalogFtsRequiredQuery(raw: string): string {
  return joinFts(requiredAskTokens(raw))
}

/** websearch OR — last-resort recall when AND misses. */
export function catalogFtsOrQuery(raw: string): string {
  const tokens = productFtsTokens(raw)
  if (tokens.length <= 1) return joinFts(tokens)
  return tokens
    .slice(0, 8)
    .map((term) => (/\s/.test(term) ? `"${term}"` : term))
    .join(' OR ')
}

/** @deprecated Prefer AND-then-relax helpers. Kept as the OR form. */
export function catalogFtsWebsearchQuery(raw: string): string {
  return catalogFtsOrQuery(raw)
}

/** Distinctive tokens for title/handle ILIKE, longest first. */
export function catalogSearchNeedles(text: string): string[] {
  return uniqueTokens(requiredAskTokens(text)).sort((a, b) => b.length - a.length)
}

/**
 * Generic split of a concatenated token (“washup” → wash). Used only when
 * the full token missed, so “camera” is not expanded to “came”.
 */
export function concatenatedSearchNeedles(token: string): string[] {
  if (token.length < 6 || /[^a-z0-9]/i.test(token)) return []
  const out: string[] = []
  for (let i = 1; i < token.length; i++) {
    const head = token.slice(0, i)
    const tail = token.slice(i)
    if (head.length >= 4) out.push(head)
    if (tail.length >= 4) out.push(tail)
  }
  return uniqueTokens(out)
}

function joinFts(tokens: string[]): string {
  return tokens
    .slice(0, 8)
    .map((term) => (/\s/.test(term) ? `"${term}"` : term))
    .join(' ')
}

function uniqueTokens(tokens: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of tokens) {
    if (!token || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}
