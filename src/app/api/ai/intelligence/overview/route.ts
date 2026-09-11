import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadIntelligenceOverview } from '@/lib/ai/intelligence/ai-intelligence-admin'

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const overview = await loadIntelligenceOverview(supabaseAdmin(), accountId)
    return NextResponse.json(overview)
  } catch (err) {
    return toErrorResponse(err)
  }
}
