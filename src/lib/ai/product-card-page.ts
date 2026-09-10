import type { ShopifyProductCard } from '@/lib/shopify'

/** WhatsApp product-card page size. Search may still gather up to MAX_PRODUCT_CARDS. */
export const PRODUCT_CARD_PAGE_SIZE = 10

export function splitProductCardPage(
  cards: ShopifyProductCard[],
  pageSize: number = PRODUCT_CARD_PAGE_SIZE,
): { page: ShopifyProductCard[]; remaining: ShopifyProductCard[] } {
  const size =
    Number.isFinite(pageSize) && pageSize > 0
      ? Math.floor(pageSize)
      : PRODUCT_CARD_PAGE_SIZE
  return {
    page: cards.slice(0, size),
    remaining: cards.slice(size),
  }
}

/** True for a Show more button tap or typed "show more" / "see more". */
export function isShowMoreAsk(text: string | null | undefined): boolean {
  const raw = (text ?? '').trim()
  if (!raw) return false
  if (/(?:action:\s*)?wacrm:show_more\b/i.test(raw)) return true
  return /\b(?:show|see)\s+more\b/i.test(raw)
}
