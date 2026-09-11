import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { listAccountSalesPatterns } from '@/lib/ai/intelligence/ai-intelligence-admin'

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const result = await listAccountSalesPatterns(supabaseAdmin(), accountId)
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
