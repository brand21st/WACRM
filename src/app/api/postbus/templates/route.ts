import { requireApiKey } from '@/lib/auth/api-context'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import {
  POSTBUS_CONFIG_COLUMNS,
  isGlobalPostBusMode,
  type PostBusIntegrationRow,
} from '@/lib/postbus/config'
import {
  globalPostBusPublicPayload,
  upsertGlobalPostBusAccount,
} from '@/lib/postbus/global-admin'

/**
 * GET/PUT /api/postbus/templates
 *
 * Machine-to-machine template + kill-switch updates for the dedicated
 * global sender. Requires postbus:send. Merchant PUT /config cannot
 * change routing_mode; this path is the only API-key way to own globals.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'postbus:send')
    const { data, error } = await ctx.supabase
      .from('postbus_integrations')
      .select(POSTBUS_CONFIG_COLUMNS)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (error) return fail('internal', 'Failed to load templates', 500)
    const row = data as unknown as PostBusIntegrationRow | null
    if (!isGlobalPostBusMode(row)) {
      return fail(
        'forbidden',
        'Templates are Super Admin owned on the global PostBus sender',
        403,
      )
    }
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
