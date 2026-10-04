import { extractVariableIndices } from '@/lib/whatsapp/template-validators'

export interface PostBusTemplateValues {
  customer_name?: string | null
  shop_name?: string | null
  order_number?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
}

function placeholderValue(
  body: string,
  index: number,
  values: Required<Record<keyof PostBusTemplateValues, string>>,
): string {
  const at = body.search(new RegExp(`\\{\\{\\s*${index}\\s*\\}\\}`))
  const before = body.slice(Math.max(0, at - 90), Math.max(0, at)).toLowerCase()
  if (/track|shipment here|click|button|http/.test(before)) {
    return values.tracking_url || values.tracking_number
  }
  if (/from\s*$/.test(before) || /this is\s*$/.test(before)) {
    return values.shop_name
  }
  if (/order(?:\s+of)?\s*$/.test(before)) {
    return values.order_number || values.tracking_number
  }
  if (/(?:hi|hello|dear)\b[^.\n]{0,24}$/.test(before)) {
    return values.customer_name
  }
  if (index === 1) return values.customer_name
  if (index === 2) return values.order_number || values.tracking_number
  if (index === 3) return values.tracking_number
  return values.tracking_url || values.tracking_number
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
  }
  const indices = extractVariableIndices(bodyText ?? '')
  return indices.map((index) => placeholderValue(bodyText ?? '', index, values))
}
