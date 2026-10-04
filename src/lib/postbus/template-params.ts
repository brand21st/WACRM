import { extractVariableIndices } from '@/lib/whatsapp/template-validators'

export interface PostBusTemplateValues {
  customer_name?: string | null
  shop_name?: string | null
  order_number?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
  amount?: string | null
  delivery_address?: string | null
}

function metaText(value: string, fallback: string) {
  const text = value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return text || fallback
}

function normalizeLabel(value: string) {
  return value.replace(/[*_`]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

function contextBefore(body: string, index: number) {
  const at = body.search(new RegExp(`\\{\\{\\s*${index}\\s*\\}\\}`))
  if (at < 0) return ''
  const lineBreak = body.lastIndexOf('\n', Math.max(0, at - 1))
  const line = normalizeLabel(body.slice(lineBreak < 0 ? 0 : lineBreak + 1, at))
  if (line) return line
  if (lineBreak <= 0) return ''
  const prevBreak = body.lastIndexOf('\n', lineBreak - 1)
  return normalizeLabel(body.slice(prevBreak < 0 ? 0 : prevBreak + 1, lineBreak))
}

function placeholderValue(
  body: string,
  index: number,
  values: Required<Record<keyof PostBusTemplateValues, string>>,
): string {
  const before = contextBefore(body, index)
  let raw = ''
  let fallback = '-'
  if (/tracking\s*(number|id|no)\b/.test(before) || /barcode\s*:?\s*$/.test(before)) {
    raw = values.tracking_number
  } else if (/track|shipment here|click|button|https?:/.test(before)) {
    raw = values.tracking_url || values.tracking_number
  } else if (/amount|total|price|₹/.test(before)) {
    raw = values.amount
  } else if (/address/.test(before)) {
    raw = values.delivery_address
  } else if (/order\s*id\b/.test(before)) {
    raw = values.order_number || values.tracking_number
  } else if (/from\s*$/.test(before) || /this is\s*$/.test(before)) {
    raw = values.shop_name
    fallback = 'our store'
  } else if (/order(?:\s+of)?\s*$/.test(before)) {
    raw = values.order_number || values.tracking_number
  } else if (/(?:hi|hello|dear)\b[^.]{0,40}$/.test(before)) {
    raw = values.customer_name
    fallback = 'Customer'
  } else if (index === 1) {
    raw = values.customer_name
    fallback = 'Customer'
  } else if (index === 2) {
    raw = values.order_number || values.tracking_number
  } else if (index === 3) {
    raw = values.tracking_number || values.order_number
  } else {
    raw = values.tracking_url || values.tracking_number
  }
  // Meta rejects an empty text parameter with (#131008).
  return metaText(raw, fallback)
}

/**
 * Fill Meta body {{N}} slots from PostBus named fields using the
 * template body as context (same heuristic PostBus uses for WATI).
 */
export function postbusTemplateBodyParams(
  bodyText: string | null | undefined,
  input: PostBusTemplateValues,
): string[] {
  const values = {
    customer_name: input.customer_name?.trim() || 'Customer',
    shop_name: input.shop_name?.trim() || '',
    order_number: input.order_number?.trim() || '',
    tracking_number: input.tracking_number?.trim() || '',
    tracking_url: input.tracking_url?.trim() || '',
    amount: input.amount?.trim() || '',
    delivery_address: input.delivery_address?.trim() || '',
  }
  const indices = extractVariableIndices(bodyText ?? '')
  return indices.map((index) => placeholderValue(bodyText ?? '', index, values))
}
