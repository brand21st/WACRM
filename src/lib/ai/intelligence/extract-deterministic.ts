/**
 * Deterministic Phase 3 extraction. No LLM. Never writes contact_ai_memory.
 */

import { classifySalesTurn } from '@/lib/shopify/sales-turn'
import type { ShoppingContext } from '@/lib/catalog/intelligence/types'
import {
  kindForEventType,
  type SalesEventKind,
  type SalesEventMetadata,
  type SalesEventV1Type,
} from './sales-event-types'

export const COMMERCE_CONFIDENCE = 0.95
export const CLASSIFY_CONFIDENCE = 0.8
export const SHOPPING_CONFIDENCE = 0.7

const PRICE_OBJECTION_TEXT =
  /\b(too expensive|cheaper|less expensive|lower price|more affordable)\b|വില\s*കൂടി|കുറഞ്ഞ\s*വില/i
const COLOR_WORD =
  /\b(colou?r|shade|നിറം|black|navy|red|blue|white|green|pink|gold|beige|yellow|orange|purple|brown|grey|gray)\b/i
const SIZE_WORD = /\b(size|വലുപ്പം|small|medium|large|xl|xxl|[sml]{1,3})\b/i

export interface AnalyzerMessage {
  id: string
  sender_type: string
  content_type: string | null
  content_text: string | null
  interactive_reply_id?: string | null
  interactive_payload?: unknown
  created_at: string
}

export interface CommerceOrderRow {
  id: string
  status: string
  conversation_id?: string | null
  contact_id?: string | null
  line_items?: unknown
}

export interface CatalogProductEventRow {
  id: string
  event: string
  product_id?: string | null
  variant_id?: string | null
}

export interface AbandonedCheckoutRow {
  id: string
  trigger_key: string
  resource_id?: string | null
  payload?: unknown
}

export interface StoredSalesEventRef {
  event_type: string
  metadata?: SalesEventMetadata | null
  source_id?: string | null
  source_table?: string | null
  source_message_id?: string | null
}

export interface CandidateSalesEvent {
  eventType: SalesEventV1Type
  kind: SalesEventKind
  confidence: number
  metadata: SalesEventMetadata
  sourceMessageId: string | null
  sourceTable: string | null
  sourceId: string | null
}

export interface DeterministicExtractInput {
  accountId: string
  conversationId: string
  contactId?: string | null
  newMessages: AnalyzerMessage[]
  commerceOrders: CommerceOrderRow[]
  catalogEvents: CatalogProductEventRow[]
  abandonedCheckouts: AbandonedCheckoutRow[]
  shopping: ShoppingContext | null
  existingEvents: StoredSalesEventRef[]
  humanTakeover?: boolean
  shopifyPaidAt?: string | null
  waCommercePaidAt?: string | null
}

export function extractDeterministicEvents(
  input: DeterministicExtractInput,
): CandidateSalesEvent[] {
  const events: CandidateSalesEvent[] = []
  const seen = new Set<string>()

  const push = (event: CandidateSalesEvent) => {
    const key = event.sourceMessageId
      ? `msg:${event.sourceMessageId}:${event.eventType}`
      : `src:${event.sourceTable}:${event.sourceId}:${event.eventType}`
    if (seen.has(key)) return
    if (alreadyStored(input.existingEvents, event)) return
    seen.add(key)
    events.push(event)
  }

  for (const message of input.newMessages) {
    for (const event of eventsFromMessage(message)) push(event)
  }

  for (const order of input.commerceOrders) {
    for (const event of eventsFromCommerceOrder(order)) push(event)
  }

  for (const row of input.catalogEvents) {
    const event = eventFromCatalogRow(row)
    if (event) push(event)
  }

  for (const row of input.abandonedCheckouts) {
    if (row.trigger_key !== 'checkout_abandoned') continue
    if (!abandonedBelongsToConversation(row, input.conversationId, input.contactId)) {
      continue
    }
    push({
      eventType: 'CHECKOUT_ABANDONED',
      kind: 'outcome',
      confidence: COMMERCE_CONFIDENCE,
      metadata: {},
      sourceMessageId: null,
      sourceTable: 'shopify_notification_jobs',
      sourceId: row.id,
    })
  }

  if (input.humanTakeover) {
    push({
      eventType: 'HUMAN_TAKEOVER',
      kind: 'signal',
      confidence: COMMERCE_CONFIDENCE,
      metadata: {},
      sourceMessageId: null,
      sourceTable: 'conversations',
      sourceId: `${input.conversationId}:ai_autoreply_disabled`,
    })
  }

  if (input.shopifyPaidAt) {
    push({
      eventType: 'PAYMENT_COMPLETED',
      kind: 'outcome',
      confidence: COMMERCE_CONFIDENCE,
      metadata: {},
      sourceMessageId: null,
      sourceTable: 'contacts',
      sourceId: `${input.contactId ?? input.conversationId}:shopify_paid_at`,
    })
  }

  if (input.waCommercePaidAt) {
    push({
      eventType: 'PAYMENT_COMPLETED',
      kind: 'outcome',
      confidence: COMMERCE_CONFIDENCE,
      metadata: {},
      sourceMessageId: null,
      sourceTable: 'contacts',
      sourceId: `${input.contactId ?? input.conversationId}:wa_commerce_paid_at`,
    })
  }

  // Rolling customer memory is not tenant-wide evidence. Selected or
  // rejected catalog IDs must come from a source message or trusted
  // commerce/catalog row, not contact_ai_memory.facts.shopping.

  return events
}

export function shouldSkipLlm(args: {
  newMessages: AnalyzerMessage[]
  deterministic: CandidateSalesEvent[]
}): boolean {
  const customerTurns = args.newMessages.filter(isCustomerLike)
  if (customerTurns.length === 0) return true
  if (args.deterministic.some((event) => event.kind === 'outcome')) return true

  const meaningful = customerTurns.filter((message) => {
    if (isWacrmButtonOnly(message)) return false
    const text = customerText(message)
    if (!text) return false
    const turn = classifySalesTurn(text)
    const tokens = text.split(/\s+/).filter(Boolean)
    if (turn.kind === 'stay' && tokens.length <= 3) return false
    return true
  })
  return meaningful.length === 0
}

function eventsFromMessage(message: AnalyzerMessage): CandidateSalesEvent[] {
  const events: CandidateSalesEvent[] = []
  if (message.content_type === 'order') {
    const productIds = retailerIdsFromPayload(message.interactive_payload)
    events.push(
      candidate({
        eventType: 'CART_CREATED',
        source: 'commerce',
        confidence: COMMERCE_CONFIDENCE,
        metadata: productIds[0] ? { productId: productIds[0] } : {},
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
    )
  }

  const selected = selectedIdsFromInteractive(message)
  if (selected.productId) {
    events.push(
      candidate({
        eventType: 'PRODUCT_SELECTED',
        source: 'nl',
        confidence: CLASSIFY_CONFIDENCE,
        metadata: { productId: selected.productId },
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
    )
  }
  if (selected.variantId) {
    events.push(
      candidate({
        eventType: 'VARIANT_SELECTED',
        source: 'nl',
        confidence: CLASSIFY_CONFIDENCE,
        metadata: {
          variantId: selected.variantId,
          ...(selected.productId ? { productId: selected.productId } : {}),
        },
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
    )
  }

  if (!isCustomerLike(message)) return events
  if (isWacrmButtonOnly(message)) return events
  const text = customerText(message)
  if (!text) return events

  const turn = classifySalesTurn(text)
  if (turn.kind === 'purchase') {
    events.push(
      candidate({
        eventType: 'PURCHASE_INTENT',
        source: 'nl',
        confidence: CLASSIFY_CONFIDENCE,
        metadata: {},
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
      candidate({
        eventType: 'READY_TO_BUY',
        source: 'nl',
        confidence: CLASSIFY_CONFIDENCE,
        metadata: {},
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
    )
    return events
  }

  if (turn.kind === 'substitution' && PRICE_OBJECTION_TEXT.test(text)) {
    events.push(
      candidate({
        eventType: 'PRICE_OBJECTION',
        source: 'nl',
        confidence: CLASSIFY_CONFIDENCE,
        metadata: { objectionType: 'price' },
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
    )
    return events
  }

  if (turn.kind === 'product_switch') {
    events.push(
      candidate({
        eventType: 'PRODUCT_OBJECTION',
        source: 'nl',
        confidence: CLASSIFY_CONFIDENCE,
        metadata: { objectionType: 'product' },
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
    )
    return events
  }

  if (turn.kind === 'comparison') {
    events.push(
      candidate({
        eventType: 'PRODUCT_COMPARISON',
        source: 'nl',
        confidence: CLASSIFY_CONFIDENCE,
        metadata: {},
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
    )
    return events
  }

  if (turn.kind === 'product_question') {
    const type: SalesEventV1Type =
      turn.topic === 'price'
        ? 'PRICE_INQUIRY'
        : turn.topic === 'availability'
          ? 'AVAILABILITY_INQUIRY'
          : 'PRODUCT_INQUIRY'
    events.push(
      candidate({
        eventType: type,
        source: 'nl',
        confidence: CLASSIFY_CONFIDENCE,
        metadata: {},
        sourceMessageId: message.id,
        sourceTable: 'messages',
        sourceId: message.id,
      }),
    )
    return events
  }

  if (turn.kind === 'variant_change') {
    if (SIZE_WORD.test(text)) {
      events.push(
        candidate({
          eventType: 'SIZE_INQUIRY',
          source: 'nl',
          confidence: CLASSIFY_CONFIDENCE,
          metadata: {},
          sourceMessageId: message.id,
          sourceTable: 'messages',
          sourceId: message.id,
        }),
      )
    }
    if (COLOR_WORD.test(text)) {
      events.push(
        candidate({
          eventType: 'COLOR_INQUIRY',
          source: 'nl',
          confidence: CLASSIFY_CONFIDENCE,
          metadata: {},
          sourceMessageId: message.id,
          sourceTable: 'messages',
          sourceId: message.id,
        }),
      )
    }
  }

  return events
}

function eventsFromCommerceOrder(order: CommerceOrderRow): CandidateSalesEvent[] {
  const events: CandidateSalesEvent[] = []
  const productId = firstLineProductId(order.line_items)
  const metadata: SalesEventMetadata = productId ? { productId } : {}
  const status = order.status

  if (status === 'pending') {
    events.push(
      candidate({
        eventType: 'CHECKOUT_STARTED',
        source: 'commerce',
        confidence: COMMERCE_CONFIDENCE,
        metadata,
        sourceMessageId: null,
        sourceTable: 'whatsapp_commerce_orders',
        sourceId: `${order.id}:pending`,
      }),
    )
  }

  if (
    status === 'processing' ||
    status === 'partially_shipped' ||
    status === 'shipped' ||
    status === 'completed'
  ) {
    events.push(
      candidate({
        eventType: 'ORDER_CREATED',
        source: 'commerce',
        confidence: COMMERCE_CONFIDENCE,
        metadata,
        sourceMessageId: null,
        sourceTable: 'whatsapp_commerce_orders',
        sourceId: `${order.id}:order`,
      }),
      candidate({
        eventType: 'PAYMENT_COMPLETED',
        source: 'commerce',
        confidence: COMMERCE_CONFIDENCE,
        metadata,
        sourceMessageId: null,
        sourceTable: 'whatsapp_commerce_orders',
        sourceId: `${order.id}:paid`,
      }),
    )
  }

  if (status === 'canceled') {
    events.push(
      candidate({
        eventType: 'ORDER_CANCELLED',
        source: 'commerce',
        confidence: COMMERCE_CONFIDENCE,
        metadata,
        sourceMessageId: null,
        sourceTable: 'whatsapp_commerce_orders',
        sourceId: `${order.id}:canceled`,
      }),
    )
  }

  return events
}

function eventFromCatalogRow(row: CatalogProductEventRow): CandidateSalesEvent | null {
  if (row.event === 'add_to_cart') {
    return candidate({
      eventType: 'CART_CREATED',
      source: 'catalog',
      confidence: COMMERCE_CONFIDENCE,
      metadata: catalogMetadata(row),
      sourceMessageId: null,
      sourceTable: 'catalog_product_events',
      sourceId: row.id,
    })
  }
  if (row.event === 'purchase') {
    return candidate({
      eventType: 'PAYMENT_COMPLETED',
      source: 'catalog',
      confidence: COMMERCE_CONFIDENCE,
      metadata: catalogMetadata(row),
      sourceMessageId: null,
      sourceTable: 'catalog_product_events',
      sourceId: row.id,
    })
  }
  return null
}

function candidate(args: {
  eventType: SalesEventV1Type
  source: 'commerce' | 'catalog' | 'nl' | 'llm' | 'shopping' | 'conversation'
  confidence: number
  metadata: SalesEventMetadata
  sourceMessageId: string | null
  sourceTable: string | null
  sourceId: string | null
}): CandidateSalesEvent {
  return {
    eventType: args.eventType,
    kind: kindForEventType(args.eventType, args.source),
    confidence: args.confidence,
    metadata: args.metadata,
    sourceMessageId: args.sourceMessageId,
    sourceTable: args.sourceTable,
    sourceId: args.sourceId,
  }
}

function alreadyStored(
  existing: StoredSalesEventRef[],
  event: CandidateSalesEvent,
): boolean {
  return existing.some((row) => {
    if (row.event_type !== event.eventType) return false
    if (event.sourceMessageId) {
      return row.source_message_id === event.sourceMessageId
    }
    return row.source_table === event.sourceTable && row.source_id === event.sourceId
  })
}

function isCustomerLike(message: AnalyzerMessage): boolean {
  return message.sender_type === 'customer'
}

function customerText(message: AnalyzerMessage): string {
  return (message.content_text ?? '').trim()
}

export function isWacrmButtonOnly(message: AnalyzerMessage): boolean {
  const replyId = message.interactive_reply_id?.trim() ?? ''
  if (replyId.startsWith('wacrm:')) return true
  const text = customerText(message)
  return /(?:action:\s*)?wacrm:[a-z0-9_]+/i.test(text) && !/\b(i'll take|too expensive|how much)\b/i.test(text)
}

function selectedIdsFromInteractive(message: AnalyzerMessage): {
  productId?: string
  variantId?: string
} {
  const payload = asRecord(message.interactive_payload)
  if (!payload) return {}
  const productId =
    str(payload.product_id) ??
    str(payload.productId) ??
    str(payload.product_retailer_id)
  const variantId = str(payload.variant_id) ?? str(payload.variantId)
  if (productId || variantId) return { productId, variantId }

  const replyId = message.interactive_reply_id?.trim() ?? ''
  if (replyId && !replyId.startsWith('wacrm:') && replyId.length >= 8) {
    if (payload.kind === 'product' || payload.kind === 'variant') {
      return payload.kind === 'variant'
        ? { variantId: replyId, productId }
        : { productId: replyId }
    }
  }
  return {}
}

function retailerIdsFromPayload(raw: unknown): string[] {
  const payload = asRecord(raw)
  const items = Array.isArray(payload?.items) ? payload.items : []
  const ids: string[] = []
  for (const item of items) {
    const row = asRecord(item)
    const id =
      str(row?.product_retailer_id) ??
      str(row?.retailer_id) ??
      str(row?.product_id) ??
      str(row?.productId)
    if (id) ids.push(id)
  }
  return ids
}

function firstLineProductId(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined
  for (const item of raw) {
    const row = asRecord(item)
    const id =
      str(row?.product_id) ??
      str(row?.productId) ??
      str(row?.retailer_id) ??
      str(row?.product_retailer_id)
    if (id) return id
  }
  return undefined
}

function catalogMetadata(row: CatalogProductEventRow): SalesEventMetadata {
  const metadata: SalesEventMetadata = {}
  if (row.product_id) metadata.productId = row.product_id
  if (row.variant_id) metadata.variantId = row.variant_id
  return metadata
}

function abandonedBelongsToConversation(
  row: AbandonedCheckoutRow,
  conversationId: string,
  contactId?: string | null,
): boolean {
  const payload = asRecord(row.payload)
  const payloadConversation = str(payload?.conversation_id) ?? str(payload?.conversationId)
  if (payloadConversation) return payloadConversation === conversationId
  const payloadContact = str(payload?.contact_id) ?? str(payload?.contactId)
  if (payloadContact && contactId) return payloadContact === contactId
  return false
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}
