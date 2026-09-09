import { parseBudget } from './rank'
import { parseShoppingRequirements } from '@/lib/catalog/intelligence/requirements'
import { wantsProductOrder } from './product-focus'
import type { SalesNextAction } from '@/lib/catalog/intelligence/types'

export type SalesTurnKind =
  | 'purchase'
  | 'product_switch'
  | 'substitution'
  | 'variant_change'
  | 'budget_change'
  | 'preference_change'
  | 'product_question'
  | 'comparison'
  | 'stay'

export type SalesTurn = {
  kind: SalesTurnKind
  nextAction: SalesNextAction
}

const MORE_OPTIONS = /(?:action:\s*)?wacrm:more_options\b/i
const GREETING_ONLY =
  /^(hi+|hii|hello|hey|ok|okay|thanks|thank you|hai|ഹായ്|നന്ദി)[.!?]*$/i

const REJECT_CURRENT =
  /\b(?:not (?:this|that|it)|don'?t want (?:this|that|it)|not interested(?: in (?:this|that))?|show (?:me )?(?:another|something else)|something else|different (?:one|product|model|saree|sari|kurti|dress))\b|ഇത്\s*വേണ്ട|ഇതല്ല|വേറെ\s+(?:saree|sari|kurti|dress|model|one)|മറ്റൊരു/i

const PRODUCT_NOUN =
  /\b(saree|sari|kurti|kurta|dress|bag|blouse|shoe|model|product|item|one)\b|സാരി|കുര്‍ത്തി|കുര്ത്തി/i

const VARIANT_WORD =
  /\b(colou?r|size|shade|നിറം|വലുപ്പം|small|medium|large|xl|xxl|[sml]{1,3}|black|navy|red|blue|white|green|pink|gold|beige|yellow|orange|purple|brown|grey|gray)\b/i

const ANOTHER_VARIANT =
  /\b(?:another|different|other)\s+(?:colou?r|size|shade)\b|വേറെ\s*(?:നിറം|വലുപ്പം|color|colour|size)|മറ്റൊരു\s*(?:നിറം|വലുപ്പം|color|colour|size)|(?:same (?:one|thing)|this (?:one|same)|ഇത്\s*തന്നെ).{0,24}\b(?:in\s+)?(?:colou?r|size|red|blue|navy|black|white|green|pink|gold|beige)\b/i

const SWITCH_WITH_CATEGORY =
  /\b(?:another|else|different|other|വേറെ|മറ്റൊരു)\b.{0,24}\b(saree|sari|kurti|kurta|dress|bag|blouse|shoe|model|product)\b|\b(saree|sari|kurti|kurta|dress|bag|blouse|shoe|model)\b.{0,16}\b(?:another|else|different|other|വേറെ)\b/i

const SUBSTITUTION =
  /\b(too expensive|cheaper|less expensive|lower price|more affordable|similar|better|alternative|substitute)\b|വില\s*കൂടി|കുറഞ്ഞ\s*വില/i

const PREFERENCE =
  /\b(?:i (?:prefer|like)|prefer|actually|instead)\s+(?:the\s+)?(black|navy|red|blue|white|green|pink|gold|beige|yellow|orange|purple|brown|grey|gray|[smlxl]{1,3})\b|\b(?:change(?:d)? (?:to|it to)|make it)\s+(black|navy|red|blue|white|green|pink|gold|beige)\b/i

const QUESTION =
  /\b(material|fabric|fit|price|available|availability|in stock|how much|what(?:'s| is) (?:the )?price|details?|tell me about this|what is this|what'?s this|is this cotton|എത്ര|വില|ലഭ്യമാണോ|സ്റ്റോക്ക്)\b/i

const FOCUSED_QUESTION =
  /ഈ\s*(?:product|ഉൽപ്പന്നം)?\s*എന്താണ്|ഇത്\s*എന്താണ്|ഇതെന്താണ്|ഇതിനെക്കുറിച്ച്|ഏത്\s*(?:material|fabric|fit)|available\s*ആണോ|\bഉണ്ടോ\b|cotton\s*ആണോ|(?:sizes?|colou?rs?)\s*(?:ഉണ്ടോ)?/i

const POSITIVE_FEEDBACK =
  /^(?:(?:it'?s |it is |this is |that'?s )?(?:nice|good|beautiful|great|lovely)|looks?(?: really)? (?:good|beautiful|nice|great)|നല്ലതാണ്)[.!?]*$/i

const COMPARISON =
  /\b(?:this or that|which (?:is |one is )?(?:better|cheaper|best)|compare|difference|vs\.?)\b|ഏതാണ്\s*നല്ലത്/i

const MALAYALAM_BUY = /ഇത്\s*വേണം|(?:ഇത്\s*)?എടുക്കാം|എടുക്കട്ടെ|വാങ്ങണം|ഓർഡർ\s*ചെയ്യ/i
const MALAYALAM_REJECT = /ഇത്\s*വേണ്ട|ഇതല്ല/

export function classifySalesTurn(
  text: string | null | undefined,
  opts?: { hasFocus?: boolean; moreOptions?: boolean },
): SalesTurn {
  const raw = (text ?? '').trim()
  if (!raw) return turn('stay')
  if (opts?.moreOptions || MORE_OPTIONS.test(raw)) return turn('product_switch')
  if (GREETING_ONLY.test(raw) || POSITIVE_FEEDBACK.test(raw)) return turn('stay')

  if (MALAYALAM_REJECT.test(raw) || REJECT_CURRENT.test(raw)) {
    if (ANOTHER_VARIANT.test(raw) && !SWITCH_WITH_CATEGORY.test(raw)) {
      return turn('variant_change')
    }
    return turn('product_switch')
  }

  if (MALAYALAM_BUY.test(raw) || wantsProductOrder(raw)) {
    return turn('purchase')
  }

  if (COMPARISON.test(raw)) return turn('comparison')

  if (SUBSTITUTION.test(raw)) return turn('substitution')

  if (ANOTHER_VARIANT.test(raw) || isVariantWithoutProductNoun(raw, opts?.hasFocus)) {
    return turn('variant_change')
  }

  if (SWITCH_WITH_CATEGORY.test(raw)) return turn('product_switch')

  if (PREFERENCE.test(raw)) return turn('preference_change')

  const budget = parseBudget(raw)
  if (budget && (budget.max != null || budget.min != null)) {
    return turn('budget_change')
  }

  if (QUESTION.test(raw) || (opts?.hasFocus && FOCUSED_QUESTION.test(raw))) {
    return turn('product_question')
  }

  const req = parseShoppingRequirements(raw)
  if (req.optionValue && opts?.hasFocus && !PRODUCT_NOUN.test(raw)) {
    return turn('variant_change')
  }
  if (req.optionValue && !PRODUCT_NOUN.test(raw)) {
    return turn('preference_change')
  }

  return turn('stay')
}

export function nextActionForSalesTurn(kind: SalesTurnKind): SalesNextAction {
  switch (kind) {
    case 'purchase':
      return 'start_purchase'
    case 'product_switch':
    case 'substitution':
      return 'show_alternatives'
    case 'variant_change':
      return 'ask_variant'
    case 'budget_change':
    case 'preference_change':
      return 'show_products'
    case 'product_question':
      return 'answer_question'
    case 'comparison':
      return 'compare_products'
    default:
      return 'wait_for_customer'
  }
}

export function unlocksCatalogBrowse(kind: SalesTurnKind): boolean {
  return kind === 'product_switch' || kind === 'substitution'
}

export function shouldPersistSalesContext(kind: SalesTurnKind): boolean {
  return (
    kind === 'purchase' ||
    kind === 'product_switch' ||
    kind === 'substitution' ||
    kind === 'variant_change' ||
    kind === 'budget_change' ||
    kind === 'preference_change' ||
    kind === 'product_question' ||
    kind === 'comparison'
  )
}

function turn(kind: SalesTurnKind): SalesTurn {
  return { kind, nextAction: nextActionForSalesTurn(kind) }
}

function isVariantWithoutProductNoun(
  raw: string,
  hasFocus?: boolean,
): boolean {
  if (!VARIANT_WORD.test(raw)) return false
  if (SWITCH_WITH_CATEGORY.test(raw)) return false
  if (/\b(?:another|else|different|other|വേറെ)\b/i.test(raw) && PRODUCT_NOUN.test(raw)) {
    return false
  }
  if (/\b(?:another|else|different|other)\s+(?:colou?r|size|shade)\b/i.test(raw)) {
    return true
  }
  if (hasFocus && !PRODUCT_NOUN.test(raw)) return true
  return (
    /\bsame (?:one|thing)\b/i.test(raw) ||
    /\bin\s+(?:red|blue|navy|black|white|green|pink|gold|beige)\b/i.test(raw) ||
    /\bsize\s+[a-z0-9]{1,12}\b/i.test(raw)
  )
}
