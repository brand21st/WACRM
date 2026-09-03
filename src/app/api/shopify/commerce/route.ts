import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  loadCommerceSettings,
  publicCommercePayload,
  saveCommerceSettings,
} from '@/lib/shopify/commerce-config'
import { parseRetailerIdSource } from '@/lib/shopify/retailer-id'
import { isCompleteBeneficiary } from '@/lib/commerce/order-details'
import type { CommerceBeneficiary } from '@/lib/commerce/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * POST /api/shopify/commerce  (admin+)
 *
 * Saves WhatsApp catalog + Razorpay Payments fields on shopify_configs.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`shopify-commerce:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: existing } = await supabase
      .from('shopify_configs')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!existing) {
      return bad('Connect Shopify first, then save Commerce settings.')
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    let shipBeneficiary: CommerceBeneficiary | null | undefined
    if ('ship_beneficiary' in body) {
      if (body.ship_beneficiary == null) {
        shipBeneficiary = null
      } else if (isCompleteBeneficiary(body.ship_beneficiary)) {
        shipBeneficiary = body.ship_beneficiary
      } else {
        return bad(
          'Default ship-to needs name, address, city, state, and a 6-digit PIN',
        )
      }
    }

    await saveCommerceSettings(supabase, accountId, {
      metaCatalogId:
        typeof body.meta_catalog_id === 'string' ? body.meta_catalog_id : undefined,
      metaCatalogAutoSync:
        typeof body.meta_catalog_auto_sync === 'boolean'
          ? body.meta_catalog_auto_sync
          : undefined,
      retailerIdSource:
        typeof body.retailer_id_source === 'string'
          ? parseRetailerIdSource(body.retailer_id_source)
          : undefined,
      waPaymentConfigurationName:
        typeof body.wa_payment_configuration_name === 'string'
          ? body.wa_payment_configuration_name
          : undefined,
      razorpayKeyId:
        typeof body.razorpay_key_id === 'string' ? body.razorpay_key_id : undefined,
      razorpayKeySecret:
        typeof body.razorpay_key_secret === 'string'
          ? body.razorpay_key_secret
          : undefined,
      clearRazorpaySecret: body.clear_razorpay_secret === true,
      razorpayWebhookSecret:
        typeof body.razorpay_webhook_secret === 'string'
          ? body.razorpay_webhook_secret
          : undefined,
      clearRazorpayWebhookSecret: body.clear_razorpay_webhook_secret === true,
      ...(shipBeneficiary !== undefined ? { shipBeneficiary } : {}),
    })

    const settings = await loadCommerceSettings(supabase, accountId)
    return NextResponse.json({
      success: true,
      ...publicCommercePayload(settings),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
