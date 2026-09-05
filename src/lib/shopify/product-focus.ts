import type { SupabaseClient } from '@supabase/supabase-js'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { parseCartPermalink } from './permalinks'
import { handleFromProductUrl } from './match-variant'

export const PRODUCT_FOCUS_STAGES = [
  'focused',
  'collecting_variants',
  'ready_to_confirm',
] as const

export type ProductFocusStage = (typeof PRODUCT_FOCUS_STAGES)[number]
export type ProductFocusSetBy = 'reply_draft' | 'send'

export interface ProductFocus {
  handle: string
  title?: string
  variantId?: string | null
  color?: string | null
  size?: string | null
  sourceMessageId: string
  stage: ProductFocusStage
  setBy: ProductFocusSetBy
  introSent?: boolean
}

export interface ProductFocusMessage {
  id: string
  content_type?: string | null
  content_text?: string | null
  interactive_payload?: InteractiveMessagePayload | null
}

const VIEW_URL = /(?:^|\n)\s*View:\s*(\S+)/i
const PRODUCT_PATH = /https?:\/\/[^\s]+\/products\/[^/?#\s]+/i
const CART_PATH = /https?:\/\/[^\s]+\/cart\/[^/?#\s]+/i

const ORDER_INTENT =
  /\b(order|buy|purchase|checkout|cart|i(?:'|’)ll take|add to cart|send (?:me )?(?:the )?link|i want (?:this|it|one|to order))\b/i

export function parseProductFocus(raw: unknown): ProductFocus | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const handle = typeof row.handle === 'string' ? row.handle.trim() : ''
  if (!handle) return null
  const sourceMessageId =
    typeof row.sourceMessageId === 'string' ? row.sourceMessageId.trim() : ''
  if (!sourceMessageId) return null
  const stage = PRODUCT_FOCUS_STAGES.includes(row.stage as ProductFocusStage)
    ? (row.stage as ProductFocusStage)
    : 'focused'
  const setBy: ProductFocusSetBy = row.setBy === 'send' ? 'send' : 'reply_draft'
  return {
    handle,
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : undefined,
    variantId:
      typeof row.variantId === 'string' && row.variantId.trim()
        ? row.variantId.trim()
        : null,
    color:
      typeof row.color === 'string' && row.color.trim() ? row.color.trim() : null,
    size: typeof row.size === 'string' && row.size.trim() ? row.size.trim() : null,
    sourceMessageId,
    stage,
    setBy,
    introSent: row.introSent === true,
  }
}

export function productFocusFromMessage(
  message: ProductFocusMessage | null | undefined,
): Omit<ProductFocus, 'stage' | 'setBy' | 'introSent'> | null {
  if (!message?.id) return null
  const payload = message.interactive_payload
  const body =
    payload && 'body' in payload && typeof payload.body === 'string'
      ? payload.body
      : (message.content_text ?? '')
  const text = [body, message.content_text].filter(Boolean).join('\n')

  let handle: string | null = null
  let variantId: string | null = null
  if (payload?.kind === 'cta_url') {
    const storedHandle =
      typeof payload.shopify_handle === 'string'
        ? payload.shopify_handle.trim()
        : ''
    if (storedHandle) handle = storedHandle
    const storedVariant =
      typeof payload.shopify_variant_id === 'string'
        ? payload.shopify_variant_id.trim()
        : ''
    if (storedVariant) variantId = storedVariant
    if (!handle) handle = handleFromProductUrl(payload.url)
    if (!variantId) {
      variantId = parseCartPermalink(payload.url)[0]?.variantId ?? null
    }
  }

  if (!handle) {
    const view = text.match(VIEW_URL)?.[1]
    handle = handleFromProductUrl(view) ?? handleFromProductUrl(text.match(PRODUCT_PATH)?.[0])
  }
  if (!variantId) {
    const cart = text.match(CART_PATH)?.[0]
    variantId = cart ? (parseCartPermalink(cart)[0]?.variantId ?? null) : null
  }

  if (!handle) return null
  const title = titleFromCardText(text)
  return {
    handle,
    title,
    variantId,
    sourceMessageId: message.id,
  }
}

export function titleFromCardText(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^view:/i.test(trimmed)) continue
    if (/^stock\s+(in|out)$/i.test(trimmed)) continue
    if (/^https?:\/\//i.test(trimmed)) continue
    if (/^~?\d/.test(trimmed)) continue
    return trimmed
  }
  return undefined
}

export function wantsProductOrder(text: string | null | undefined): boolean {
  const raw = (text ?? '').trim()
  if (!raw) return false
  if (raw.includes('wacrm:confirm_order')) return true
  return ORDER_INTENT.test(raw)
}

export function formatProductFocusNote(focus: {
  handle: string
  title?: string | null
}): string {
  const title = focus.title?.trim()
  return title
    ? `Replying to product: ${title} (${focus.handle})`
    : `Replying to product: ${focus.handle}`
}

export function formatProductFocusPrompt(focus: {
  handle: string
  title?: string | null
}): string {
  const label = focus.title?.trim()
    ? `${focus.title.trim()} (handle: ${focus.handle})`
    : focus.handle
  return (
    `The inbox agent selected this Shopify product as the reply target: ${label}. ` +
    'Discuss only this product. Do not search, recommend, or send other products. ' +
    'Do not mention checkout or cart links until the customer says they want to order it. ' +
    'If they want to order, collect color and size needs — variant lists and Confirm order / Continue chat buttons are sent separately.'
  )
}

export function shouldClearDraftFocus(
  current: ProductFocus | null,
  dismissedMessageId: string,
): boolean {
  return (
    current?.setBy === 'reply_draft' &&
    current.sourceMessageId === dismissedMessageId
  )
}

export async function saveProductFocus(
  db: SupabaseClient,
  conversationId: string,
  focus: ProductFocus,
): Promise<void> {
  const { error } = await db
    .from('conversations')
    .update({ ai_product_focus: focus })
    .eq('id', conversationId)
  if (error) {
    console.warn('[product-focus] save failed:', error.message)
  }
}

export async function clearProductFocus(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const { error } = await db
    .from('conversations')
    .update({ ai_product_focus: null })
    .eq('id', conversationId)
  if (error) {
    console.warn('[product-focus] clear failed:', error.message)
  }
}
