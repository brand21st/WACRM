import crypto from 'crypto'

export function verifyRazorpayWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature || !secret) return false
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature.trim())
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function accountIdFromRazorpayNotes(notes: unknown): string | null {
  if (!notes || typeof notes !== 'object') return null
  const raw = (notes as Record<string, unknown>).account_id
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

export function receiptFromRazorpayPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const rec = payload as Record<string, unknown>
  const entity =
    (rec.payload && typeof rec.payload === 'object'
      ? (rec.payload as Record<string, unknown>)
      : rec) ?? {}
  const order =
    (entity.order as { entity?: { receipt?: string } } | undefined)?.entity ??
    (entity.payment as { entity?: { notes?: { account_id?: string } } } | undefined)
      ?.entity
  const receipt =
    (entity.order as { entity?: { receipt?: string } } | undefined)?.entity
      ?.receipt ??
    (typeof rec.receipt === 'string' ? rec.receipt : null)
  return receipt?.trim() || null
}
