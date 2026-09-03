export const CHECKOUT_BUTTON_LABEL = 'Checkout NOW'
export const VIEW_CART_BUTTON_LABEL = 'View cart'

const CTA_BODY_MAX = 1024

/**
 * WhatsApp Checkout card body — the product card the customer reads
 * above the Checkout button (title, price, stock, variants, View URL).
 */
export function ctaBodyFromCard(card: {
  title?: string | null
  caption?: string | null
}): string {
  const body = (card.caption ?? '').trim()
  return (body || card.title?.trim() || CHECKOUT_BUTTON_LABEL).slice(
    0,
    CTA_BODY_MAX,
  )
}

export function cardHasCheckout(card: {
  inStock?: boolean
  checkoutUrl?: string | null
}): boolean {
  return Boolean(card.inStock && card.checkoutUrl?.trim())
}

export function firstCheckoutFromCards(
  cards: { checkoutUrl?: string | null; title?: string | null }[],
): { url: string; title: string } | null {
  for (const card of cards) {
    const url = card.checkoutUrl?.trim()
    if (!url) continue
    const title = card.title?.trim() || CHECKOUT_BUTTON_LABEL
    return { url, title }
  }
  return null
}

/** Strip every trusted checkout URL (and leftover Buy now: labels) from the text bubble. */
export function stripCheckoutUrlsFromReply(
  text: string,
  urls: (string | null | undefined)[],
): string {
  let out = text
  for (const url of urls) {
    if (url?.trim()) out = stripCheckoutFromReply(out, url)
  }
  return out
}

/** Remove a trusted checkout URL and leftover Buy now: labels from the text bubble. */
export function stripCheckoutFromReply(text: string, checkoutUrl: string): string {
  const href = checkoutUrl.trim()
  if (!href) return text.trim()
  const escaped = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let out = text.replace(new RegExp(escaped, 'gi'), '')
  out = out.replace(/\b(?:Buy(?:\s+now)?|Checkout|View cart)\s*:\s*/gi, '')
  out = out.replace(/[ \t]+\n/g, '\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  out = out.replace(/[ \t]{2,}/g, ' ')
  return out.trim()
}
