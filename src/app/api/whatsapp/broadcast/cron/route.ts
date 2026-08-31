// ============================================================
// GET /api/whatsapp/broadcast/cron
//
// Drain one due scheduled broadcast per tick. Same `x-cron-secret` /
// `AUTOMATION_CRON_SECRET` as automations, flows, and Shopify
// notifications. Limit 1 so overlapping pings don't stack Meta
// rate-limit pressure — a minute cadence is enough.
//
// Delivery reuses the resume fan-out (`planBroadcastResume` +
// `deliverBroadcast` in `after()`). Recipients and template params
// were frozen when the wizard scheduled the campaign.
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { after, NextResponse } from 'next/server';

import { BroadcastError, deliverBroadcast, finalizeBroadcastStatus } from '@/lib/whatsapp/broadcast-core';
import {
  planBroadcastResume,
  releaseBroadcastDelivery,
} from '@/lib/whatsapp/broadcast-resume';
import {
  claimScheduledBroadcast,
  findDueScheduledBroadcast,
  markScheduledBroadcastSending,
} from '@/lib/whatsapp/broadcast-schedule';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export const maxDuration = 300;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const due = await findDueScheduledBroadcast(admin);
  if (!due) {
    return NextResponse.json({ processed: 0 });
  }

  const claimed = await claimScheduledBroadcast(admin, due.id);
  if (!claimed) {
    return NextResponse.json({ processed: 0, skipped: 1 });
  }

  try {
    const { plan, remaining, unsendable } = await planBroadcastResume(
      admin,
      claimed.account_id,
      claimed.id,
      'pending'
    );

    const flipped = await markScheduledBroadcastSending(admin, claimed.id);
    if (!flipped) {
      await releaseBroadcastDelivery(admin, claimed.id);
      return NextResponse.json({ processed: 0, cancelled: 1 });
    }

    after(async () => {
      try {
        await deliverBroadcast(admin, plan);
      } catch (err) {
        console.error(
          '[broadcast-cron] delivery threw:',
          err instanceof Error ? err.message : err
        );
        await finalizeBroadcastStatus(admin, claimed.id).catch(() => {});
      } finally {
        await releaseBroadcastDelivery(admin, claimed.id);
      }
    });

    return NextResponse.json(
      {
        processed: 1,
        broadcast_id: claimed.id,
        sending: plan.planned.length,
        remaining,
        unsendable,
      },
      { status: 202 }
    );
  } catch (error) {
    await releaseBroadcastDelivery(admin, claimed.id).catch(() => {});
    if (error instanceof BroadcastError) {
      return NextResponse.json(
        { error: error.message, code: error.code, processed: 0 },
        { status: error.status }
      );
    }
    console.error('[broadcast-cron] drain failed:', error);
    return NextResponse.json(
      { error: 'Failed to drain scheduled broadcast', processed: 0 },
      { status: 500 }
    );
  }
}
