export const SHOPIFY_NOTIFICATION_TRIGGERS = [
  'new_order',
  'processing',
  'checkout_abandoned',
  'fulfilled',
  'tracking',
  'delivered',
  'after_delivered',
  'refund',
  'return_request',
] as const

export type ShopifyNotificationTrigger =
  (typeof SHOPIFY_NOTIFICATION_TRIGGERS)[number]

export const SHOPIFY_NOTIFICATION_FIELDS = [
  'customer_first_name',
  'customer_last_name',
  'customer_name',
  'order_name',
  'order_number',
  'total',
  'currency',
  'checkout_url',
  'abandoned_checkout_url',
  'checkout_url_partial',
  'discount_code',
  'tracking_number',
  'tracking_url',
  'tracking_url_partial',
  'tracking_company',
  'order_status_url',
  'order_status_url_partial',
  'product_details',
  'customer_address',
  'shop_name',
  'refund_amount',
] as const

export type ShopifyNotificationField =
  (typeof SHOPIFY_NOTIFICATION_FIELDS)[number]

export type ShopifyVariableMap = Record<string, ShopifyNotificationField | string>

export interface ShopifyNotificationRuleConfig {
  delay_hours?: number
  discount_code?: string
  days_after?: number
}

export interface ShopifyNotificationRule {
  trigger_key: ShopifyNotificationTrigger
  is_enabled: boolean
  template_name: string | null
  template_language: string
  variable_map: ShopifyVariableMap
  config: ShopifyNotificationRuleConfig
}

export const DEFAULT_DELAY_HOURS = 1
export const DEFAULT_DAYS_AFTER = 3

export const DEFAULT_VARIABLE_MAPS: Record<
  ShopifyNotificationTrigger,
  ShopifyVariableMap
> = {
  new_order: {
    '1': 'customer_first_name',
    '2': 'order_name',
    '3': 'total',
  },
  processing: {
    '1': 'customer_first_name',
    '2': 'order_name',
    '3': 'total',
  },
  checkout_abandoned: {
    '1': 'customer_first_name',
    '2': 'checkout_url',
    '3': 'discount_code',
  },
  fulfilled: {
    '1': 'order_name',
    '2': 'tracking_number',
    '3': 'tracking_url',
  },
  tracking: {
    '1': 'order_name',
    '2': 'tracking_number',
    '3': 'tracking_url',
  },
  delivered: {
    '1': 'customer_first_name',
    '2': 'order_name',
  },
  after_delivered: {
    '1': 'customer_first_name',
    '2': 'order_name',
  },
  refund: {
    '1': 'order_name',
    '2': 'refund_amount',
  },
  return_request: {
    '1': 'order_name',
  },
}

export function isShopifyNotificationTrigger(
  value: string,
): value is ShopifyNotificationTrigger {
  return (SHOPIFY_NOTIFICATION_TRIGGERS as readonly string[]).includes(value)
}

export function defaultRule(
  trigger: ShopifyNotificationTrigger,
): ShopifyNotificationRule {
  const config: ShopifyNotificationRuleConfig = {}
  if (trigger === 'checkout_abandoned') {
    config.delay_hours = DEFAULT_DELAY_HOURS
    config.discount_code = ''
  }
  if (trigger === 'after_delivered') {
    config.days_after = DEFAULT_DAYS_AFTER
  }
  return {
    trigger_key: trigger,
    is_enabled: false,
    template_name: null,
    template_language: 'en_US',
    variable_map: { ...DEFAULT_VARIABLE_MAPS[trigger] },
    config,
  }
}

export function mergeRules(
  rows: Partial<ShopifyNotificationRule>[],
): ShopifyNotificationRule[] {
  const byKey = new Map<string, Partial<ShopifyNotificationRule>>()
  for (const row of rows) {
    if (row.trigger_key) byKey.set(row.trigger_key, row)
  }
  return SHOPIFY_NOTIFICATION_TRIGGERS.map((key) => {
    const base = defaultRule(key)
    const row = byKey.get(key)
    if (!row) return base
    return {
      ...base,
      ...row,
      trigger_key: key,
      variable_map:
        row.variable_map &&
        typeof row.variable_map === 'object' &&
        Object.keys(row.variable_map).length > 0
          ? row.variable_map
          : base.variable_map,
      config: {
        ...base.config,
        ...(row.config && typeof row.config === 'object' ? row.config : {}),
      },
    }
  })
}

export function buildBodyParams(
  variableMap: ShopifyVariableMap,
  fields: Record<string, string>,
): string[] {
  const indices = Object.keys(variableMap)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
  if (indices.length === 0) return []
  const max = indices[indices.length - 1]
  const out: string[] = []
  for (let i = 1; i <= max; i++) {
    const fieldKey = variableMap[String(i)]
    out.push(fieldKey ? (fields[fieldKey] ?? '') : '')
  }
  return out
}
