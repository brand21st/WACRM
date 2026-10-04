import { NextResponse } from 'next/server'

import {
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  POSTBUS_CONFIG_COLUMNS,
  isGlobalPostBusMode,
  type PostBusIntegrationRow,
} from '@/lib/postbus/config'
import type { PostBusTestResultCode } from '@/lib/postbus/types'
import {
  accountHasSendApiKey,
  probeWhatsAppPhone,
} from '@/lib/postbus/readiness'

function result(
  code: PostBusTestResultCode,
  message: string,
  httpStatus: number,
) {
  return NextResponse.json(
    {
      ok: code === 'connection_successful',
      code,
      message,
    },
    { status: httpStatus },
  )
}

/**
 * POST /api/postbus/config/test  (admin+)
 *
 * Does not send a customer WhatsApp and does not call a PostBus URL.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `postbus-config-test:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const { data, error } = await supabase
      .from('postbus_integrations')
      .select(POSTBUS_CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[postbus/config/test] fetch error:', error)
      return result('api_error', 'Failed to load PostBus connection', 500)
    }

    const row = data as unknown as PostBusIntegrationRow | null
    const merchant = row?.postbus_merchant_id?.trim() ?? ''
    const global = isGlobalPostBusMode(row)
    if (!row || (!global && !merchant)) {
      const stamped = await stamp(supabase, accountId, 'configuration_missing')
      void stamped
      return result(
        'configuration_missing',
        global
          ? 'Save the global PostBus sender configuration first.'
          : 'PostBus merchant ID is required.',
        400,
      )
    }

    let code: PostBusTestResultCode
    let message: string
    let status: number

    try {
      const wa = await probeWhatsAppPhone(supabase, accountId)
      if (wa === 'missing') {
        code = 'whatsapp_not_configured'
        message = 'WhatsApp Cloud API is not configured for this account.'
        status = 400
      } else if (wa === 'error') {
        code = 'api_error'
        message = 'WhatsApp credentials could not be verified with Meta.'
        status = 502
      } else {
        const hasKey = await accountHasSendApiKey(supabase, accountId)
        if (!hasKey) {
          code = 'authentication_failed'
          message =
            'No active API key with messages:send or postbus:send exists for this account.'
          status = 400
        } else {
          code = 'connection_successful'
          message = global
            ? 'WhatsApp, the global template map, and a send-capable API key are ready.'
            : 'Merchant mapping, WhatsApp, and a send-capable API key are ready.'
          status = 200
        }
      }
    } catch (err) {
      console.error('[postbus/config/test] probe failed')
      void err
      code = 'api_error'
      message = 'Failed to verify PostBus prerequisites.'
      status = 500
    }

    await stamp(supabase, accountId, code)
    return result(code, message, status)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return result('invalid_account', 'Invalid account.', 401)
    }
    return toErrorResponse(err)
  }
}

async function stamp(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  code: PostBusTestResultCode,
) {
  const { error: stampErr } = await supabase
    .from('postbus_integrations')
    .update({
      last_tested_at: new Date().toISOString(),
      last_test_result: code,
    })
    .eq('account_id', accountId)

  if (stampErr) {
    console.error('[postbus/config/test] stamp error:', stampErr)
  }
}
