import type { ChatLanguageLock } from '@/lib/ai/language-lock'
import type { SalesNextAction } from '@/lib/catalog/intelligence/types'
import {
  findVariant,
  inStockColors,
  inStockSizes,
  inferOptionsFromAsk,
  resolveVariantPicker,
  valuesEqual,
} from './match-variant'
import {
  descriptionExcerpt,
  hitAvailabilityKnown,
  hitInStock,
  resolveStructuredMaterial,
  type ProductFactFocus,
} from './product-facts'
import type { SalesTurnKind, ProductQuestionTopic } from './sales-turn'
import type { ShopifyProductHit } from './types'

export type FocusedFactReply = {
  text: string
  nextAction: SalesNextAction
}

export type FocusedFactReplyInput = {
  topic?: ProductQuestionTopic
  kind?: SalesTurnKind
  ask?: string | null
  hit: ShopifyProductHit
  focus?: ProductFactFocus
  language?: ChatLanguageLock | null
}

const MALAYALAM_SCRIPT = /[\u0D00-\u0D7F]/
const TYPE_IN_DESCRIPTION = /\bTYPE\s*:\s*([^.\n]+)/i
const COTTON_ASK = /\bcotton\b|cotton\s*ആണോ/i

export function focusedReplyDirective(turn: {
  kind: SalesTurnKind
  topic?: ProductQuestionTopic
}): string | null {
  if (turn.kind === 'product_question') {
    const topic = turn.topic ?? 'other'
    return (
      `Answer this ${topic} question only. Do not recap the product card. ` +
      'Do not ask a follow-up unless Current product facts say ask_size or ask_color is yes. ' +
      'Do not name Shopify, WACRM, Meta, tools, or handles. Do not invent material, stock, or price.'
    )
  }
  if (turn.kind === 'variant_change') {
    return (
      'Confirm the requested color or size from Current product facts. ' +
      'If only one size remains, confirm it and do not ask size. ' +
      'If the product has no color or size options, do not ask. Do not recap the card.'
    )
  }
  return null
}

export function buildFocusedFactReply(
  input: FocusedFactReplyInput,
): FocusedFactReply | null {
  const kind = input.kind ?? (input.topic ? 'product_question' : undefined)
  const ml = replyInMalayalam(input.language, input.ask)
  const focus = mergeFocus(input.hit, input.focus, input.ask)

  if (kind === 'product_question' || input.topic) {
    switch (input.topic ?? 'other') {
      case 'material':
        return materialReply(input.hit, input.ask, ml)
      case 'identity':
        return identityReply(input.hit, ml)
      case 'availability':
        return availabilityReply(input.hit, focus, ml, { askOptions: false })
      case 'price':
        return priceReply(input.hit, ml)
      default:
        return null
    }
  }

  if (kind === 'variant_change') {
    return variantReply(input.hit, focus, input.ask, ml)
  }

  return null
}

function mergeFocus(
  hit: ShopifyProductHit,
  focus: ProductFactFocus | undefined,
  ask: string | null | undefined,
): { color?: string | null; size?: string | null } {
  const inferred = inferOptionsFromAsk(ask, hit.variants)
  return {
    color: focus?.color?.trim() || inferred.color || null,
    size: focus?.size?.trim() || inferred.size || null,
  }
}

function materialReply(
  hit: ShopifyProductHit,
  ask: string | null | undefined,
  ml: boolean,
): FocusedFactReply {
  const material = resolveStructuredMaterial(hit)
  if (!material) {
    return {
      text: ml
        ? 'ഈ product-ന്റെ material information ഇപ്പോൾ ലഭ്യമല്ല.'
        : 'Material information for this product is not available right now.',
      nextAction: 'wait_for_customer',
    }
  }
  if (COTTON_ASK.test(ask ?? '')) {
    const isCotton = /cotton/i.test(material.value)
    if (isCotton) {
      return {
        text: ml
          ? `അതെ, ${material.value} ആണ്.`
          : `Yes, it is ${material.value}.`,
        nextAction: 'wait_for_customer',
      }
    }
    return {
      text: ml
        ? `അല്ല, ഇത് ${material.value} material ആണ്.`
        : `No, the material is ${material.value}.`,
      nextAction: 'wait_for_customer',
    }
  }
  return {
    text: ml
      ? `ഇത് ${material.value} material ആണ്.`
      : `The material is ${material.value}.`,
    nextAction: 'wait_for_customer',
  }
}

function identityReply(hit: ShopifyProductHit, ml: boolean): FocusedFactReply {
  const type = identityType(hit)
  const label = type || hit.title.trim()
  return {
    text: ml ? `ഇത് ഒരു ${label} ആണ്.` : `This is ${label}.`,
    nextAction: 'wait_for_customer',
  }
}

function identityType(hit: ShopifyProductHit): string | null {
  const excerpt = descriptionExcerpt(hit.description, 400)
  const match = excerpt.match(TYPE_IN_DESCRIPTION)
  const type = match?.[1]?.trim()
  if (!type) return null
  if (/^(material|fabric|silk|linen|cotton|rayon)\b/i.test(type)) return null
  return type
}

function priceReply(hit: ShopifyProductHit, ml: boolean): FocusedFactReply | null {
  const min = hit.priceMin?.trim() || ''
  const max = hit.priceMax?.trim() || ''
  if (!min && !max) return null
  const unit = ml ? 'രൂപ' : 'rupees'
  if (min && max && min !== max) {
    return {
      text: ml
        ? `വില ${min} മുതൽ ${max} ${unit} വരെ.`
        : `The price is ${min} to ${max} ${unit}.`,
      nextAction: 'wait_for_customer',
    }
  }
  const amount = min || max
  return {
    text: ml
      ? `ഇതിന്റെ വില ${amount} ${unit} ആണ്.`
      : `The price is ${amount} ${unit}.`,
    nextAction: 'wait_for_customer',
  }
}

function availabilityReply(
  hit: ShopifyProductHit,
  focus: { color?: string | null; size?: string | null },
  ml: boolean,
  opts: { askOptions: boolean },
): FocusedFactReply {
  const color = focus.color?.trim() || null
  const size = focus.size?.trim() || null

  if (!hitAvailabilityKnown(hit)) {
    return {
      text: ml
        ? 'സ്റ്റോക്ക് വിവരം ഇപ്പോൾ ലഭ്യമല്ല.'
        : 'Stock information is not available right now.',
      nextAction: 'wait_for_customer',
    }
  }

  const colors = inStockColors(hit.variants)
  const sizes = inStockSizes(hit.variants)
  const hasColor = colors.length > 0
  const hasSize = sizes.length > 0

  if (hit.variants.length === 0) {
    return {
      text: hitInStock(hit) ? inStockText(ml) : outOfStockText(ml),
      nextAction: 'wait_for_customer',
    }
  }

  const stocked = hit.variants.filter((v) => v.available)
  if (stocked.length === 0) {
    return { text: outOfStockText(ml), nextAction: 'wait_for_customer' }
  }

  if (!hasColor && !hasSize) {
    return { text: inStockText(ml), nextAction: 'wait_for_customer' }
  }

  if (color && size) {
    const variant = findVariant(hit.variants, { color, size })
    if (variant) {
      return {
        text: ml
          ? `${color} / ${size} available ആണ്.`
          : `${color} / ${size} is in stock.`,
        nextAction: 'wait_for_customer',
      }
    }
    const sizesForColor = inStockSizes(hit.variants, color)
    if (sizesForColor.length === 1) {
      return {
        text: ml
          ? `${color} / ${size} ഇപ്പോൾ ഇല്ല. ${color}-ൽ ${sizesForColor[0]} മാത്രമാണ് available.`
          : `${color} / ${size} is out of stock. Only size ${sizesForColor[0]} remains for ${color}.`,
        nextAction: 'wait_for_customer',
      }
    }
    if (sizesForColor.length > 0) {
      return {
        text: ml
          ? `${color} / ${size} ഇപ്പോൾ ഇല്ല. ${color}-ൽ ${sizesForColor.join(', ')} available ആണ്.`
          : `${color} / ${size} is out of stock. In-stock sizes for ${color}: ${sizesForColor.join(', ')}.`,
        nextAction: 'wait_for_customer',
      }
    }
    if (colors.length > 0) {
      return {
        text: ml
          ? `${color} ഇപ്പോൾ ഇല്ല. Available colors: ${colors.join(', ')}.`
          : `${color} is out of stock. In-stock colors: ${colors.join(', ')}.`,
        nextAction: 'wait_for_customer',
      }
    }
    return { text: outOfStockText(ml), nextAction: 'wait_for_customer' }
  }

  if (color) {
    const sizesForColor = inStockSizes(hit.variants, color)
    const colorInStock = colors.some((c) => valuesEqual(c, color))
    if (colorInStock) {
      if (sizesForColor.length <= 1) {
        return {
          text:
            sizesForColor.length === 1
              ? oneSizeText(color, sizesForColor[0], ml)
              : ml
                ? `${color} available ആണ്.`
                : `${color} is in stock.`,
          nextAction: 'wait_for_customer',
        }
      }
      if (opts.askOptions) {
        return {
          text: ml
            ? `${color} available ആണ്. ഏത് size വേണം?`
            : `${color} is available. Which size would you like?`,
          nextAction: 'ask_variant',
        }
      }
      return {
        text: ml
          ? `${color} available ആണ്. Sizes: ${sizesForColor.join(', ')}.`
          : `${color} is in stock. Sizes: ${sizesForColor.join(', ')}.`,
        nextAction: 'wait_for_customer',
      }
    }
    if (colors.length > 0) {
      return {
        text: ml
          ? `${color} ഇപ്പോൾ ഇല്ല. Available colors: ${colors.join(', ')}.`
          : `${color} is out of stock. In-stock colors: ${colors.join(', ')}.`,
        nextAction: 'wait_for_customer',
      }
    }
    return { text: outOfStockText(ml), nextAction: 'wait_for_customer' }
  }

  if (size) {
    const colorsForSize = inStockColors(hit.variants, size)
    const sizeInStock = sizes.some((s) => valuesEqual(s, size))
    if (sizeInStock) {
      return {
        text: colorsForSize.length
          ? ml
            ? `Size ${size} available ആണ്. Colors: ${colorsForSize.join(', ')}.`
            : `Size ${size} is in stock. Colors: ${colorsForSize.join(', ')}.`
          : ml
            ? `Size ${size} available ആണ്.`
            : `Size ${size} is in stock.`,
        nextAction: 'wait_for_customer',
      }
    }
    if (sizes.length > 0) {
      return {
        text: ml
          ? `Size ${size} ഇപ്പോൾ ഇല്ല. Available sizes: ${sizes.join(', ')}.`
          : `Size ${size} is out of stock. In-stock sizes: ${sizes.join(', ')}.`,
        nextAction: 'wait_for_customer',
      }
    }
    return { text: outOfStockText(ml), nextAction: 'wait_for_customer' }
  }

  if (stocked.length === hit.variants.length) {
    return { text: inStockText(ml), nextAction: 'wait_for_customer' }
  }

  const bits = ml
    ? ['ചില options സ്റ്റോക്കിലുണ്ട്']
    : ['Some options are in stock']
  if (colors.length) bits.push(ml ? `colors ${colors.join(', ')}` : `colors ${colors.join(', ')}`)
  if (sizes.length) bits.push(ml ? `sizes ${sizes.join(', ')}` : `sizes ${sizes.join(', ')}`)
  return {
    text: `${bits.join('. ')}.`,
    nextAction: 'wait_for_customer',
  }
}

function variantReply(
  hit: ShopifyProductHit,
  focus: { color?: string | null; size?: string | null },
  ask: string | null | undefined,
  ml: boolean,
): FocusedFactReply | null {
  const picker = resolveVariantPicker({
    product: hit,
    ask,
    chosenColor: focus.color,
    chosenSize: focus.size,
  })
  const hasColor = inStockColors(hit.variants).length > 0
  const hasSize = inStockSizes(hit.variants).length > 0

  if (!hasColor && !hasSize) {
    return { text: inStockText(ml), nextAction: 'wait_for_customer' }
  }

  const inferred = inferOptionsFromAsk(ask, hit.variants)
  const namedColor = Boolean(focus.color?.trim() || inferred.color)
  const namedSize = Boolean(focus.size?.trim() || inferred.size)
  if (!namedColor && !namedSize) return null

  if (picker.kind === 'done' && picker.variant) {
    const color = picker.color || variantOption(picker.variant, 'color')
    const size = picker.size || variantOption(picker.variant, 'size')
    if (color && size) {
      return {
        text: ml
          ? `${color} / ${size} available ആണ്.`
          : `${color} / ${size} is in stock.`,
        nextAction: 'wait_for_customer',
      }
    }
    return { text: inStockText(ml), nextAction: 'wait_for_customer' }
  }

  if (picker.kind === 'size' && picker.color) {
    if (picker.sizes.length === 1) {
      return {
        text: oneSizeText(picker.color, picker.sizes[0], ml),
        nextAction: 'wait_for_customer',
      }
    }
    if (picker.sizes.length > 1) {
      return {
        text: ml
          ? `${picker.color} available ആണ്. ഏത് size വേണം?`
          : `${picker.color} is available. Which size would you like?`,
        nextAction: 'ask_variant',
      }
    }
  }

  if (picker.kind === 'color' && picker.colors.length === 1) {
    const only = picker.colors[0]
    const sizesForColor = inStockSizes(hit.variants, only)
    if (sizesForColor.length <= 1) {
      return {
        text:
          sizesForColor.length === 1
            ? oneSizeText(only, sizesForColor[0], ml)
            : ml
              ? `${only} available ആണ്.`
              : `${only} is in stock.`,
        nextAction: 'wait_for_customer',
      }
    }
    return {
      text: ml
        ? `${only} available ആണ്. ഏത് size വേണം?`
        : `${only} is available. Which size would you like?`,
      nextAction: 'ask_variant',
    }
  }

  if (picker.kind === 'oos') {
    return availabilityReply(hit, {
      color: picker.color ?? focus.color,
      size: picker.size ?? focus.size,
    }, ml, { askOptions: false })
  }

  return null
}

function variantOption(
  variant: { options?: { name: string; value: string }[] },
  kind: 'color' | 'size',
): string | null {
  const match = variant.options?.find((row) => {
    const name = row.name.toLowerCase()
    return kind === 'color'
      ? /colou?r|നിറം/.test(name)
      : /size|വലുപ്പം/.test(name)
  })
  return match?.value?.trim() || null
}

function oneSizeText(color: string, size: string, ml: boolean): string {
  return ml
    ? `${color}-ൽ ${size} മാത്രമാണ് available.`
    : `${color} is in stock. Only size ${size} remains.`
}

function inStockText(ml: boolean): string {
  return ml ? 'ഉണ്ട്, ഇപ്പോൾ സ്റ്റോക്കിലുണ്ട്.' : 'Yes, it is in stock.'
}

function outOfStockText(ml: boolean): string {
  return ml ? 'ഇപ്പോൾ സ്റ്റോക്കിലില്ല.' : 'It is currently out of stock.'
}

function replyInMalayalam(
  language: ChatLanguageLock | null | undefined,
  ask: string | null | undefined,
): boolean {
  if (language?.locked) return language.code === 'ml'
  if (language?.code === 'ml') return true
  return MALAYALAM_SCRIPT.test(ask ?? '')
}
