import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { getAccountExperimentDetail } from '@/lib/ai/intelligence/ai-intelligence-admin'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { accountId } = await requireRole('admin')
    const { id } = await context.params
    const detail = await getAccountExperimentDetail(
      supabaseAdmin(),
      accountId,
      id,
    )
    if (!detail) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json(detail)
  } catch (err) {
    return toErrorResponse(err)
  }
}
