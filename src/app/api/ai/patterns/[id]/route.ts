import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { getAccountSalesPattern } from '@/lib/ai/intelligence/ai-intelligence-admin'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { accountId } = await requireRole('admin')
    const { id } = await context.params
    const result = await getAccountSalesPattern(supabaseAdmin(), accountId, id)
    if (!result.available) {
      return NextResponse.json({ available: false, pattern: null })
    }
    if (!result.pattern) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ available: true, pattern: result.pattern })
  } catch (err) {
    return toErrorResponse(err)
  }
}
