import { storefrontOrigin } from './domain'

export function storePageUrl(
  primaryDomain: string | null | undefined,
  handle: string,
): string {
  const origin = storefrontOrigin(primaryDomain)
  const h = handle.replace(/^\/+|\/+$/g, '')
  if (!origin || !h) return ''
  return `${origin}/pages/${h}`
}

export function productPageUrl(
  primaryDomain: string | null | undefined,
  handle: string,
): string {
  const origin = storefrontOrigin(primaryDomain)
  const h = handle.replace(/^\/+|\/+$/g, '')
  if (!origin || !h) return ''
  return `${origin}/products/${h}`
}

export function cartPermalink(
  primaryDomain: string | null | undefined,
  legacyVariantId: string,
  quantity = 1,
): string {
  const origin = storefrontOrigin(primaryDomain)
  const id = String(legacyVariantId).trim()
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1
  if (!origin || !id) return ''
  return `${origin}/cart/${id}:${qty}`
}

export function checkoutPermalink(
  primaryDomain: string | null | undefined,
  legacyVariantId: string,
  quantity = 1,
): string {
  const cart = cartPermalink(primaryDomain, legacyVariantId, quantity)
  return cart ? `${cart}?checkout` : ''
}
