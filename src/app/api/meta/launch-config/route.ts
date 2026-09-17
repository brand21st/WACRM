import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { META_API_VERSION } from '@/lib/meta/graph'
import { resolveFacebookLoginConfig } from '@/lib/meta/platform-settings'

export async function GET() {
  try {
    await requireRole('viewer')
    const cfg = await resolveFacebookLoginConfig()
    return NextResponse.json({
      appId: cfg.appId,
      configId: cfg.configId,
      graphVersion: META_API_VERSION,
      enabled: cfg.enabled,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
