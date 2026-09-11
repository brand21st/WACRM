import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/ai/admin-client';
import { loadMerchantLearningSummary } from '@/lib/ai/intelligence/learning-summary';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const { accountId } = await requireRole('admin');
    const summary = await loadMerchantLearningSummary(
      supabaseAdmin(),
      accountId
    );
    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
