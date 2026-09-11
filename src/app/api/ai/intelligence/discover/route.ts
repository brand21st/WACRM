import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { discoverAccountPatterns } from '@/lib/ai/intelligence/discover-patterns'

export async function POST() {
  try {
    const { accountId } = await requireRole('admin')
    const result = await discoverAccountPatterns(supabaseAdmin(), accountId)
    return NextResponse.json({
      wrote: result.wrote,
      stale_updated: result.staleUpdated,
      skipped: result.skipped,
      reason: result.reason ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
