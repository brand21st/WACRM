import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadQueueOperationsHealth } from '@/lib/queue/queue-health'

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const operations = await loadQueueOperationsHealth()
    return NextResponse.json(
      { account_id: accountId, ...operations },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
