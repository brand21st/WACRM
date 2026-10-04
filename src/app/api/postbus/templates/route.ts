import { requireApiKey } from '@/lib/auth/api-context'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import {
  POSTBUS_CONFIG_COLUMNS,
  type PostBusIntegrationRow,
} from '@/lib/postbus/config'
import {
  globalPostBusPublicPayload,
  upsertGlobalPostBusAccount,
} from '@/lib/postbus/global-admin'

/**
 * GET/PUT /api/postbus/templates
 *
 * GET returns mapped event templates plus approved WhatsApp templates
 * for this API key's account (even before routing_mode is global).
 * PUT is the API-key way to own/update the dedicated global sender.
 * Requires postbus:send.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'postbus:send')
    const { data, error } = await ctx.supabase
      .from('postbus_integrations')
      .select(POSTBUS_CONFIG_COLUMNS)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    const row = (!error && data
      ? (data as unknown as PostBusIntegrationRow)
      : null) ?? ({ account_id: ctx.accountId } as PostBusIntegrationRow)
    return ok(await globalPostBusPublicPayload(ctx.supabase, row))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'postbus:send')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400)
    }

    const saved = await upsertGlobalPostBusAccount(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.createdBy,
      body,
    })
    return ok(await globalPostBusPublicPayload(ctx.supabase, saved))
  } catch (err) {
    return toApiErrorResponse(err)
  }
}
