import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadObservationShadow } from '@/lib/ai/intelligence/observation-admin'

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const report = await loadObservationShadow(supabaseAdmin(), accountId)
    return NextResponse.json(report)
  } catch (err) {
    return toErrorResponse(err)
  }
}
