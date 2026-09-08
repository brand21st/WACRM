import { parseBudget, parsePriceArg } from '@/lib/shopify/rank'
import type { ShoppingRequirements } from './types'

const CHEAPER =
  /\b(too expensive|cheaper|less expensive|lower price|more affordable|budget)\b/i
const SIZE = /\bsize\s+([a-z0-9]{1,12})\b/i
const NAMED_OPTION =
  /\b(?:in|colour|color)\s+([a-z][a-z0-9-]{2,24})\b|\b(black|navy|red|blue|white|green|pink|gold|beige)\b/i
const OCCASION =
  /\b(wedding|party|office|casual|festive|birthday|anniversary|gift)\b/i
const RECIPIENT =
  /\b(?:for (?:my |a )?)(wife|husband|mom|mother|dad|father|sister|brother|friend|daughter|son)\b/i
const DISLIKE_PHRASE =
  /\b(?:don'?t like|do not like|avoid)\s+([a-z][a-z0-9-]{1,20})\b/gi
const NO_COLOR =
  /\bno\s+(black|navy|red|blue|white|green|pink|gold|beige|yellow|orange|purple|brown|grey|gray)\b/gi
const REJECT_SHOWN = /\b(?:not (?:that|this|it)|don'?t want (?:that|this))\b/i
const SELECT_SHOWN =
  /\b(?:this one|i(?:'ll| will) take (?:this|that)|that one)\b/i
const ORDINAL =
  /\b(?:the )?(first|1st|second|2nd|third|3rd)(?:\s+(?:one|option|product|item))?\b/i
const CATEGORY =
  /\b(saree|sari|bag|tote|clutch|blouse|kurta|dress|shoe|wallet|jewellery|jewelry)\b/i

const ORDINAL_INDEX: Record<string, number> = {
  first: 0,
  '1st': 0,
  second: 1,
  '2nd': 1,
  third: 2,
  '3rd': 2,
}

export function parseShoppingRequirements(
  text: string | null | undefined,
  extras?: Partial<ShoppingRequirements>,
): ShoppingRequirements {
  const budget = parseBudget(text)
  const size = text?.match(SIZE)?.[1]
  const namedMatch = text?.match(NAMED_OPTION)
  const named = namedMatch?.[1] ?? namedMatch?.[2]
  const optionValue = extras?.optionValue ?? size ?? named
  const optionName =
    extras?.optionName ??
    (size ? 'size' : named ? undefined : extras?.optionName)

  return {
    minPrice: extras?.minPrice ?? budget?.min,
    maxPrice: extras?.maxPrice ?? budget?.max,
    cheaper: extras?.cheaper ?? CHEAPER.test(text ?? ''),
    optionName,
    optionValue,
    attributeKey: extras?.attributeKey,
    attributeValue: extras?.attributeValue,
  }
}

export function parseOccasion(text: string | null | undefined): string | undefined {
  const match = text?.match(OCCASION)?.[1]
  return match ? match.toLowerCase() : undefined
}

export function parseRecipient(text: string | null | undefined): string | undefined {
  const match = text?.match(RECIPIENT)?.[1]
  return match ? match.toLowerCase() : undefined
}

export function parseDislikes(text: string | null | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const re of [DISLIKE_PHRASE, NO_COLOR]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) {
      const value = match[1]?.trim().toLowerCase()
      if (!value || seen.has(value)) continue
      seen.add(value)
      out.push(value)
    }
  }
  return out
}

export function parseShownOrdinal(text: string | null | undefined): number | null {
  const raw = text?.match(ORDINAL)?.[1]
  if (!raw) return null
  const index = ORDINAL_INDEX[raw.toLowerCase()]
  return index == null ? null : index
}

export function parseRejectsShown(text: string | null | undefined): boolean {
  return REJECT_SHOWN.test(text ?? '')
}

export function parseSelectsShown(text: string | null | undefined): boolean {
  return SELECT_SHOWN.test(text ?? '')
}

export function parseCategoryHint(text: string | null | undefined): string | undefined {
  const match = text?.match(CATEGORY)?.[1]
  if (!match) return undefined
  return match.toLowerCase() === 'sari' ? 'saree' : match.toLowerCase()
}

export function requirementsFromToolArgs(
  args: Record<string, unknown>,
  customerText?: string | null,
): ShoppingRequirements {
  return parseShoppingRequirements(customerText, {
    minPrice: parsePriceArg(args.min_price),
    maxPrice: parsePriceArg(args.max_price),
    optionName: str(args.option_name) || undefined,
    optionValue: str(args.option_value) || undefined,
    attributeKey: str(args.attribute_key) || undefined,
    attributeValue: str(args.attribute_value) || undefined,
    cheaper: CHEAPER.test(customerText ?? '') || CHEAPER.test(str(args.query)),
  })
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
