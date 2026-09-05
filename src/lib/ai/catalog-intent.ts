/**
 * Conservative detector for a WhatsApp-catalog request.
 * Named product searches such as "catalog of red bags" stay product searches.
 */

const NAMED_CATALOG = /\bcatalog(?:ue)?s?\s+of\b/
const NEW_OR_BEST =
  /\b(new products?|new arrivals?|best[- ]?sell(?:ing|ers?)|bestsellers?|trending)\b/i

const STANDALONE_CATALOG =
  /^(please\s+)?((can\s+you\s+|could\s+you\s+)?(show|open|browse|send|view|share)\s+(me\s+)?(the\s+)?)?(your\s+|the\s+)?(whatsapp\s+|store\s+|wa\s+|commerce\s+)?catalog(?:ue)?s?$/

const BROWSE_ALL_PRODUCTS =
  /^(please\s+)?((can\s+you\s+|could\s+you\s+)?(show|open|browse|send|view|share|list)\s+(me\s+)?(the\s+)?)?(your\s+|the\s+|all\s+)?products?$/

const WHAT_PRODUCTS =
  /\b(what|whats|which|endhokke|enthokke|ethokke|enthu|ethu)\s+(all\s+)?products?\b/

const FOLLOW_UP =
  /^(evide|where|where is it|kannunilla|kanunnilla|can'?t see|cannot see|not (showing|received|coming)|again|resend|refresh|ayakku)$/i

function normalizeAsk(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/[,\u2013\u2014]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isWhatsAppCatalogRequest(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  if (/\(action:\s*wacrm:/i.test(raw)) return false

  const t = normalizeAsk(raw)
  if (!t) return false
  if (NEW_OR_BEST.test(t) || NAMED_CATALOG.test(t)) return false

  if (STANDALONE_CATALOG.test(t)) return true
  if (/\b(whatsapp|wa|commerce|store|product)\s+catalog(?:ue)?s?\b/.test(t)) {
    return true
  }
  if (/\bbrowse\s+(the\s+|your\s+)?(store\s+)?catalog(?:ue)?s?\b/.test(t)) {
    return true
  }
  if (/\bകാറ്റലോഗ്\b/.test(raw) || /\bcatalog(?:ue)?s?\b/.test(t)) {
    return !NAMED_CATALOG.test(t)
  }
  if (WHAT_PRODUCTS.test(t) || BROWSE_ALL_PRODUCTS.test(t)) return true
  return false
}

export function isCatalogFollowUp(text: string): boolean {
  const t = normalizeAsk(text)
  if (!t) return false
  if (FOLLOW_UP.test(t)) return true
  return /\b(evide|where is (it|the catalog)|can'?t see|kannunilla|kanunnilla|resend|refresh)\b/.test(
    t,
  )
}

export function recentTurnMentionedCatalog(
  messages: { role?: string; content?: string }[],
): boolean {
  const start = Math.max(0, messages.length - 6)
  for (let i = messages.length - 1; i >= start; i--) {
    const content = messages[i]?.content ?? ''
    if (/\bcatalog(?:ue)?s?\b|കാറ്റലോഗ്/i.test(content)) return true
  }
  return false
}

export function replyClaimsCatalogSent(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  const catalog = '(?:catalog(?:ue)?s?|കാറ്റലോഗ്)'
  const sent = '(?:sent|ayakku|ayachu|അയച്ച|വന്ന|browse)'
  return (
    new RegExp(`\\b${catalog}.{0,80}${sent}`, 'i').test(raw) ||
    new RegExp(`${sent}.{0,80}\\b${catalog}`, 'i').test(raw)
  )
}

export function wantsWhatsAppCatalog(args: {
  customerText: string
  replyText?: string | null
  messages?: { role?: string; content?: string }[]
  toolRequested?: boolean
}): boolean {
  if (args.toolRequested) return true
  if (isWhatsAppCatalogRequest(args.customerText)) return true
  if (replyClaimsCatalogSent(args.replyText ?? '')) return true
  if (
    isCatalogFollowUp(args.customerText) &&
    recentTurnMentionedCatalog(args.messages ?? [])
  ) {
    return true
  }
  return false
}
