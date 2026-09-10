import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopifyProductCard } from '@/lib/shopify'

export const COMMERCE_OFFER_CARD_CAP = 3
export const COMMERCE_FOLLOW_UP_MIN_MINUTES = 30

export type CommercePendingAction =
  | 'SHOW_PRODUCT'
  | 'SHOW_PRODUCT_IMAGE'
  | 'START_ORDER'
  | 'SHOW_VARIANTS'

export type CommerceFollowUpKind =
  | 'accept_show'
  | 'request_image'
  | 'accept_order'
  | 'none'

export type CommerceTurn = {
  conversationId: string
  currentProduct?: string
  currentBrand?: string
  requestedPrice?: number
  alternativePrice?: number
  lastSearchQuery?: string
  lastSearchExact?: boolean
  lastOfferedCards: ShopifyProductCard[]
  pendingAction?: CommercePendingAction | null
  pendingQuestion?: string | null
  acceptedAlternative?: boolean
  unavailabilityTold?: boolean
}

const AFFIRM =
  /^(ok|okay|yes|yeah|yep|yup|sure|send|show(?:\s+me)?|ശരി|വേണം|അതെ|കാണിക്കൂ|അയക്കൂ)[.!?]*$/i

const PHOTO =
  /\b(photo|pic|pics|picture|image)s?\b|ഫോട്ടോ|ചിത്രം|photo\s+please|photo\s+അയക്കൂ|ഫോട്ടോ\s*(?:വേണം|അയക്കൂ)|ചിത്രം\s*വേണം/i

const IMMEDIATE_SHOW =
  /കാണിക്കൂ|show\s+me|send\s+(?:me\s+)?(?:the\s+)?(?:photo|image|pic)|ayakku|അയക്കൂ/i

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function num(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function parseCard(raw: unknown): ShopifyProductCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const title = str(row.title)
  const productUrl = str(row.productUrl)
  if (!title || !productUrl) return null
  return {
    title,
    imageUrl: str(row.imageUrl),
    productUrl,
    cartUrl: str(row.cartUrl),
    checkoutUrl: str(row.checkoutUrl),
    inStock: Boolean(row.inStock),
    caption: typeof row.caption === 'string' ? row.caption : title,
    retailerId: str(row.retailerId),
    handle: str(row.handle),
    variantId: str(row.variantId),
    catalogId: str(row.catalogId),
  }
}

function isPendingAction(value: unknown): value is CommercePendingAction {
  return (
    value === 'SHOW_PRODUCT' ||
    value === 'SHOW_PRODUCT_IMAGE' ||
    value === 'START_ORDER' ||
    value === 'SHOW_VARIANTS'
  )
}

export function emptyCommerceTurn(conversationId: string): CommerceTurn {
  return {
    conversationId,
    lastOfferedCards: [],
    pendingAction: null,
    pendingQuestion: null,
    acceptedAlternative: false,
    unavailabilityTold: false,
  }
}

export function parseCommerceTurn(raw: unknown): CommerceTurn | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const conversationId = str(row.conversationId)
  if (!conversationId) return null
  const cards = Array.isArray(row.lastOfferedCards)
    ? row.lastOfferedCards
        .map(parseCard)
        .filter((card): card is ShopifyProductCard => Boolean(card))
        .slice(0, COMMERCE_OFFER_CARD_CAP)
    : []
  return {
    conversationId,
    currentProduct: str(row.currentProduct) ?? undefined,
    currentBrand: str(row.currentBrand) ?? undefined,
    requestedPrice: num(row.requestedPrice),
    alternativePrice: num(row.alternativePrice),
    lastSearchQuery: str(row.lastSearchQuery) ?? undefined,
    lastSearchExact: typeof row.lastSearchExact === 'boolean' ? row.lastSearchExact : undefined,
    lastOfferedCards: cards,
    pendingAction: isPendingAction(row.pendingAction) ? row.pendingAction : null,
    pendingQuestion: str(row.pendingQuestion),
    acceptedAlternative: row.acceptedAlternative === true,
    unavailabilityTold: row.unavailabilityTold === true,
  }
}

export function serializeCommerceTurn(turn: CommerceTurn): Record<string, unknown> {
  return {
    conversationId: turn.conversationId,
    currentProduct: turn.currentProduct ?? null,
    currentBrand: turn.currentBrand ?? null,
    requestedPrice: turn.requestedPrice ?? null,
    alternativePrice: turn.alternativePrice ?? null,
    lastSearchQuery: turn.lastSearchQuery ?? null,
    lastSearchExact: turn.lastSearchExact ?? null,
    lastOfferedCards: turn.lastOfferedCards.slice(0, COMMERCE_OFFER_CARD_CAP),
    pendingAction: turn.pendingAction ?? null,
    pendingQuestion: turn.pendingQuestion ?? null,
    acceptedAlternative: Boolean(turn.acceptedAlternative),
    unavailabilityTold: Boolean(turn.unavailabilityTold),
  }
}

export function hasOpenCommercePending(turn: CommerceTurn | null | undefined): boolean {
  return Boolean(turn?.pendingAction && turn.lastOfferedCards.length > 0)
}

export function isPhotoRequest(text: string | null | undefined): boolean {
  return PHOTO.test((text ?? '').trim())
}

export function isCommerceAffirmation(text: string | null | undefined): boolean {
  return AFFIRM.test((text ?? '').trim())
}

export function isImmediateShowAsk(text: string | null | undefined): boolean {
  const raw = (text ?? '').trim()
  if (!raw) return false
  return isPhotoRequest(raw) || IMMEDIATE_SHOW.test(raw)
}

export function resolveCommerceFollowUp(
  text: string | null | undefined,
  turn: CommerceTurn | null | undefined,
): CommerceFollowUpKind {
  const raw = (text ?? '').trim()
  if (!raw) return 'none'
  const cards = turn?.lastOfferedCards ?? []
  if (isPhotoRequest(raw) && cards.length > 0) return 'request_image'
  if (!isCommerceAffirmation(raw)) return 'none'
  if (turn?.pendingAction === 'START_ORDER') return 'accept_order'
  if (turn?.pendingAction === 'SHOW_PRODUCT_IMAGE' && cards.length > 0) {
    return 'request_image'
  }
  if (turn?.pendingAction === 'SHOW_PRODUCT' && cards.length > 0) {
    return 'accept_show'
  }
  if (turn?.pendingAction === 'SHOW_VARIANTS') return 'accept_show'
  return 'none'
}

export function offeredCardsToReplay(turn: CommerceTurn | null | undefined): ShopifyProductCard[] {
  return (turn?.lastOfferedCards ?? []).slice(0, COMMERCE_OFFER_CARD_CAP)
}

export function formatCommerceSnapshot(turn: CommerceTurn | null | undefined): string {
  if (!turn) return ''
  const lines: string[] = []
  if (turn.currentProduct) lines.push(`current_product: ${turn.currentProduct}`)
  if (turn.currentBrand) lines.push(`current_brand: ${turn.currentBrand}`)
  if (turn.requestedPrice != null) lines.push(`requested_price: ${turn.requestedPrice}`)
  if (turn.alternativePrice != null) {
    lines.push(`alternative_price: ${turn.alternativePrice}`)
  }
  const offered = turn.lastOfferedCards[0]
  if (offered) {
    lines.push(`last_offered: ${offered.title}`)
  }
  if (turn.pendingAction) lines.push(`pending_action: ${turn.pendingAction}`)
  if (turn.pendingQuestion) lines.push(`pending_question: ${turn.pendingQuestion}`)
  if (turn.acceptedAlternative) lines.push('customer_accepted_alternative: yes')
  if (turn.unavailabilityTold) {
    lines.push('do_not_repeat_unavailability: yes')
  }
  if (lines.length === 0) return ''
  return lines.join('\n')
}

export function heldOfferReplyDirective(
  requestedPrice?: number,
  alternativePrice?: number,
): string {
  const asked = requestedPrice != null ? `₹${requestedPrice}` : 'the requested price'
  const alt = alternativePrice != null ? `₹${alternativePrice}` : 'the closest catalog option'
  return (
    `No exact ${asked} match. Offer the ${alt} alternative once and ask if they want to see it. ` +
    'Do not send product cards on this turn. Do not say the alternative is the requested price. ' +
    'Do not explain internal search.'
  )
}

export function acceptedOfferReplyDirective(): string {
  return (
    'Customer accepted the pending alternative. Introduce it briefly and show it. ' +
    'Do not repeat that the original price is unavailable. Do not search the catalog again.'
  )
}

export function photoReuseReplyDirective(): string {
  return (
    'Customer asked for the known product photo. Use that product image. ' +
    'Do not search again. Do not repeat availability.'
  )
}

export async function loadCommerceTurn(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null | undefined,
  conversationId: string,
): Promise<CommerceTurn | null> {
  if (!contactId) return null
  try {
    const { data, error } = await db
      .from('contact_ai_memory')
      .select('facts')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (error || !data) return null
    const facts = (data as { facts?: { commerceTurn?: unknown } }).facts
    const parsed = parseCommerceTurn(facts?.commerceTurn)
    if (!parsed || parsed.conversationId !== conversationId) return null
    return parsed
  } catch {
    return null
  }
}

async function readFacts(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from('contact_ai_memory')
    .select('facts')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (error) throw error
  if (data?.facts && typeof data.facts === 'object' && !Array.isArray(data.facts)) {
    return { ...(data.facts as Record<string, unknown>) }
  }
  return {}
}

export async function persistCommerceTurn(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
  turn: CommerceTurn | null,
): Promise<void> {
  const facts = await readFacts(db, accountId, contactId)
  if (!turn || (turn.lastOfferedCards.length === 0 && !turn.pendingAction)) {
    delete facts.commerceTurn
  } else {
    facts.commerceTurn = serializeCommerceTurn({
      ...turn,
      conversationId,
      lastOfferedCards: turn.lastOfferedCards.slice(0, COMMERCE_OFFER_CARD_CAP),
    })
  }
  const { error } = await db.from('contact_ai_memory').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      facts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'contact_id' },
  )
  if (error) throw error
}

export async function clearCommerceTurn(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
): Promise<void> {
  await persistCommerceTurn(db, accountId, contactId, conversationId, null)
}

export function commerceTurnFromHeldOffer(args: {
  conversationId: string
  query?: string | null
  requestedPrice?: number
  alternativePrice?: number
  currentProduct?: string
  cards: ShopifyProductCard[]
}): CommerceTurn {
  return {
    conversationId: args.conversationId,
    currentProduct: args.currentProduct,
    requestedPrice: args.requestedPrice,
    alternativePrice: args.alternativePrice,
    lastSearchQuery: args.query?.trim() || undefined,
    lastSearchExact: false,
    lastOfferedCards: args.cards.slice(0, COMMERCE_OFFER_CARD_CAP),
    pendingAction: 'SHOW_PRODUCT',
    pendingQuestion: 'show_alternative',
    acceptedAlternative: false,
    unavailabilityTold: true,
  }
}
