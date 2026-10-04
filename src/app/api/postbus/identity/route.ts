import { requireApiKey } from '@/lib/auth/api-context'
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { officialWhatsAppIdentity } from '@/lib/postbus/readiness'

/**
 * GET /api/postbus/identity
 *
 * Official WhatsApp display number for the dedicated sender account.
 * Never returns Meta tokens.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'postbus:send')
    const identity = await officialWhatsAppIdentity(ctx.supabase, ctx.accountId)
    return ok({
      display_phone: identity.display_phone,
      verified_name: identity.verified_name,
      account_id: identity.account_id,
    })
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
