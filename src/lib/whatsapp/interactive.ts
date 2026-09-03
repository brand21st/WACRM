// ============================================================
// Interactive message payload — shared shape + validation.
//
// The persisted, round-trippable representation of a WhatsApp
// interactive message (reply buttons or a list). This is the single
// source of truth used by:
//   - the inbox composer + automation "send interactive" builders,
//   - the send-message core + automation engine (send + persist),
//   - the message bubble + preview (render),
//   - quick replies (store an interactive snippet).
//
// The field names (`id`/`title`/`description` on buttons/rows) match
// `meta-api.ts`'s `InteractiveButton` / `InteractiveListRow` /
// `InteractiveListSection` on purpose, so a payload maps straight onto
// the Meta send args with no translation.
//
// `validateInteractivePayload` mirrors the throws already inside the
// meta-api senders, but returns a result object so callers (API routes,
// activation checks) can surface a clean error to the user *before* the
// network call rather than turning a bad payload into a 400 from Meta
// mid-conversation.
// ============================================================

import { INTERACTIVE_LIMITS } from './meta-api'

export interface InteractiveButton {
  /** Stable id echoed back in the webhook when tapped. */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface InteractiveButtonsPayload {
  kind: 'buttons'
  /** Body text shown above the buttons (≤ 1024 chars). */
  body: string
  /** Optional plain-text header (≤ 60 chars). */
  header?: string
  /** Optional grey footer line (≤ 60 chars). */
  footer?: string
  /** 1–3 buttons. */
  buttons: InteractiveButton[]
}

export interface InteractiveListRow {
  /** Stable id echoed back in the webhook when selected. */
  id: string
  /** Row title (≤ 24 chars per Meta). */
  title: string
  /** Optional secondary line (≤ 72 chars). */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}

export interface InteractiveListPayload {
  kind: 'list'
  body: string
  header?: string
  footer?: string
  /** Label of the tap-to-expand button on the message bubble (≤ 20 chars). */
  button_label: string
  /** 1–10 rows TOTAL across all sections. */
  sections: InteractiveListSection[]
}

export interface InteractiveCtaUrlPayload {
  kind: 'cta_url'
  body: string
  header?: string
  footer?: string
  /** Visible button label (≤ 20 chars). */
  display_text: string
  /** https URL opened when the customer taps Checkout. */
  url: string
  /** Optional product photo shown above the body (CTA image header). */
  header_image?: string
}

export interface InteractiveProductPayload {
  kind: 'product'
  body: string
  footer?: string
  catalog_id: string
  product_retailer_id: string
}

export interface InteractiveProductListPayload {
  kind: 'product_list'
  body: string
  header: string
  footer?: string
  catalog_id: string
  product_retailer_ids: string[]
}

export interface InteractiveCatalogMessagePayload {
  kind: 'catalog_message'
  body: string
  footer?: string
}

export interface InteractiveOrderDetailsPayload {
  kind: 'order_details'
  body: string
  footer?: string
  header_image?: string
  reference_id: string
  catalog_id?: string
}

export interface InteractiveOrderStatusPayload {
  kind: 'order_status'
  body: string
  reference_id: string
  status: string
}

export interface InteractiveInboundOrderPayload {
  kind: 'inbound_order'
  catalog_id?: string
  items: Array<{
    product_retailer_id: string
    quantity: number
    item_price?: number
    currency?: string
    name?: string
  }>
}

export type InteractiveMessagePayload =
  | InteractiveButtonsPayload
  | InteractiveListPayload
  | InteractiveCtaUrlPayload
  | InteractiveProductPayload
  | InteractiveProductListPayload
  | InteractiveCatalogMessagePayload
  | InteractiveOrderDetailsPayload
  | InteractiveOrderStatusPayload
  | InteractiveInboundOrderPayload

export type InteractiveValidation =
  | { ok: true }
  | { ok: false; error: string }

function ok(): InteractiveValidation {
  return { ok: true }
}
function fail(error: string): InteractiveValidation {
  return { ok: false, error }
}

function validateHeaderFooter(
  header: string | undefined,
  footer: string | undefined,
): InteractiveValidation {
  if (header && header.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
    return fail(
      `Header exceeds the ${INTERACTIVE_LIMITS.headerTextMaxLength}-character limit.`,
    )
  }
  if (footer && footer.length > INTERACTIVE_LIMITS.footerMaxLength) {
    return fail(
      `Footer exceeds the ${INTERACTIVE_LIMITS.footerMaxLength}-character limit.`,
    )
  }
  return ok()
}

/**
 * Validate an interactive payload against Meta's hard limits + our
 * structural rules (non-empty ids/titles, unique ids). Returns a result
 * object rather than throwing so API routes can map it to a 400 with a
 * user-facing message.
 *
 * `unknown` in, narrowed here, so it's safe to call straight on a parsed
 * request body.
 */
export function validateInteractivePayload(
  payload: unknown,
): InteractiveValidation {
  if (!payload || typeof payload !== 'object') {
    return fail('Interactive message payload is required.')
  }
  const p = payload as Partial<InteractiveMessagePayload>

  if (typeof p.body !== 'string' || p.body.trim() === '') {
    return fail('Interactive message body text is required.')
  }
  if (p.body.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    return fail(
      `Body text exceeds the ${INTERACTIVE_LIMITS.bodyMaxLength}-character limit.`,
    )
  }
  const hf = validateHeaderFooter(p.header, p.footer)
  if (!hf.ok) return hf

  if (p.kind === 'buttons') {
    const buttons = (p as InteractiveButtonsPayload).buttons
    if (!Array.isArray(buttons) || buttons.length < 1) {
      return fail('Add at least one reply button.')
    }
    if (buttons.length > INTERACTIVE_LIMITS.maxButtons) {
      return fail(
        `A reply-button message allows at most ${INTERACTIVE_LIMITS.maxButtons} buttons.`,
      )
    }
    const seen = new Set<string>()
    for (const b of buttons) {
      if (!b || typeof b.id !== 'string' || b.id.trim() === '') {
        return fail('Every button needs an id.')
      }
      if (seen.has(b.id)) {
        return fail(`Duplicate button id "${b.id}".`)
      }
      seen.add(b.id)
      if (typeof b.title !== 'string' || b.title.trim() === '') {
        return fail('Every button needs a label.')
      }
      if (b.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
        return fail(
          `Button label "${b.title}" exceeds the ${INTERACTIVE_LIMITS.buttonTitleMaxLength}-character limit.`,
        )
      }
    }
    return ok()
  }

  if (p.kind === 'list') {
    const list = p as InteractiveListPayload
    if (
      typeof list.button_label !== 'string' ||
      list.button_label.trim() === ''
    ) {
      return fail('The list needs a button label.')
    }
    if (list.button_label.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      return fail(
        `List button label exceeds the ${INTERACTIVE_LIMITS.buttonTitleMaxLength}-character limit.`,
      )
    }
    if (!Array.isArray(list.sections) || list.sections.length < 1) {
      return fail('Add at least one list section.')
    }
    if (list.sections.length > INTERACTIVE_LIMITS.maxListSections) {
      return fail(
        `A list allows at most ${INTERACTIVE_LIMITS.maxListSections} sections.`,
      )
    }
    const seen = new Set<string>()
    let total = 0
    for (const section of list.sections) {
      if (!section || !Array.isArray(section.rows)) {
        return fail('Every list section needs rows.')
      }
      for (const row of section.rows) {
        total++
        if (!row || typeof row.id !== 'string' || row.id.trim() === '') {
          return fail('Every list row needs an id.')
        }
        if (seen.has(row.id)) {
          return fail(`Duplicate list row id "${row.id}".`)
        }
        seen.add(row.id)
        if (typeof row.title !== 'string' || row.title.trim() === '') {
          return fail('Every list row needs a title.')
        }
        if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
          return fail(
            `List row title "${row.title}" exceeds the ${INTERACTIVE_LIMITS.listRowTitleMaxLength}-character limit.`,
          )
        }
        if (
          row.description &&
          row.description.length >
            INTERACTIVE_LIMITS.listRowDescriptionMaxLength
        ) {
          return fail(
            `List row description exceeds the ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength}-character limit.`,
          )
        }
      }
    }
    if (total < 1) return fail('Add at least one list row.')
    if (total > INTERACTIVE_LIMITS.maxListRowsTotal) {
      return fail(
        `A list allows at most ${INTERACTIVE_LIMITS.maxListRowsTotal} rows in total.`,
      )
    }
    return ok()
  }

  if (p.kind === 'cta_url') {
    const cta = p as InteractiveCtaUrlPayload
    if (typeof cta.display_text !== 'string' || cta.display_text.trim() === '') {
      return fail('The checkout button needs a label.')
    }
    if (cta.display_text.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      return fail(
        `Checkout button label exceeds the ${INTERACTIVE_LIMITS.buttonTitleMaxLength}-character limit.`,
      )
    }
    if (typeof cta.url !== 'string' || !/^https?:\/\//i.test(cta.url.trim())) {
      return fail('Checkout button needs an http(s) URL.')
    }
    return ok()
  }

  if (p.kind === 'product') {
    const product = p as InteractiveProductPayload
    if (!product.catalog_id?.trim() || !product.product_retailer_id?.trim()) {
      return fail('Product messages need a catalog id and retailer id.')
    }
    return ok()
  }

  if (p.kind === 'product_list') {
    const list = p as InteractiveProductListPayload
    if (!list.header?.trim()) return fail('A product list needs a header.')
    if (!list.catalog_id?.trim()) return fail('A product list needs a catalog id.')
    if (!Array.isArray(list.product_retailer_ids) || list.product_retailer_ids.length < 1) {
      return fail('Add at least one catalog product.')
    }
    return ok()
  }

  if (p.kind === 'catalog_message') return ok()

  if (p.kind === 'order_details') {
    const order = p as InteractiveOrderDetailsPayload
    if (!order.reference_id?.trim()) return fail('order_details needs a reference_id.')
    return ok()
  }

  if (p.kind === 'order_status') {
    const status = p as InteractiveOrderStatusPayload
    if (!status.reference_id?.trim()) return fail('order_status needs a reference_id.')
    return ok()
  }

  if (p.kind === 'inbound_order') {
    return fail('Inbound cart messages cannot be sent from the composer.')
  }

  return fail('Interactive message must be reply buttons, a list, or a checkout link.')
}

/**
 * Short single-line summary used for `conversations.last_message_text`
 * and quick-reply list rows — the body, trimmed, or a sensible fallback.
 */
export function interactivePayloadPreviewText(
  payload: InteractiveMessagePayload,
): string {
  if (payload.kind === 'inbound_order') {
    const n = payload.items.length
    return n === 1
      ? `Cart: ${payload.items[0]?.name || payload.items[0]?.product_retailer_id}`
      : `Cart: ${n} items`
  }
  const body = payload.body?.trim()
  if (body) return body
  if (payload.kind === 'cta_url') {
    return payload.display_text.trim() || '[checkout]'
  }
  if (payload.kind === 'product' || payload.kind === 'product_list') {
    return '[catalog]'
  }
  if (payload.kind === 'catalog_message') return '[catalog]'
  if (payload.kind === 'order_details') return '[order]'
  if (payload.kind === 'order_status') return '[order status]'
  return payload.kind === 'buttons' ? '[buttons]' : '[list]'
}
