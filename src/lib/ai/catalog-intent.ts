/**
 * Conservative detector for a standalone WhatsApp-catalog request.
 * Named product searches such as "catalog of red bags" stay product searches.
 */
export function isWhatsAppCatalogRequest(text: string): boolean {
  const raw = text.trim()
  if (!raw) return false
  if (/\(action:\s*wacrm:/i.test(raw)) return false

  const t = raw
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (/\bcatalog(?:ue)?s?\s+of\b/.test(t)) return false

  if (
    /^(please\s+)?((can\s+you\s+|could\s+you\s+)?(show|open|browse|send|view|share)\s+(me\s+)?(the\s+)?)?(your\s+|the\s+)?(whatsapp\s+|store\s+|wa\s+|commerce\s+)?catalog(?:ue)?s?$/.test(
      t,
    )
  ) {
    return true
  }

  if (/\b(whatsapp|wa|commerce)\s+catalog(?:ue)?s?\b/.test(t)) return true
  if (/\bbrowse\s+(the\s+|your\s+)?(store\s+)?catalog(?:ue)?s?\b/.test(t)) {
    return true
  }

  return false
}
