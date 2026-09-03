export const INR_OFFSET = 100

export interface InrAmount {
  value: number
  offset: number
}

export function paiseFromMajor(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * INR_OFFSET)
}

export function inrAmount(paise: number): InrAmount {
  const value = Number.isFinite(paise) ? Math.max(0, Math.round(paise)) : 0
  return { value, offset: INR_OFFSET }
}

export function assertAmountIdentity(args: {
  subtotal: number
  tax: number
  shipping: number
  discount: number
  total: number
}): void {
  const expected = args.subtotal + args.tax + args.shipping - args.discount
  if (args.total !== expected) {
    throw new Error(
      `order_details total ${args.total} must equal subtotal+tax+shipping-discount (${expected})`,
    )
  }
}

const REFERENCE_ID_RE = /^[A-Za-z0-9._-]{1,35}$/

export function isValidReferenceId(raw: string): boolean {
  return REFERENCE_ID_RE.test(raw)
}

/** Short unique id for WhatsApp order_details (≤35 chars). */
export function newCommerceReferenceId(now = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 8)
  const stamp = now.toString(36)
  const id = `wac_${stamp}${rand}`
  return id.slice(0, 35)
}
