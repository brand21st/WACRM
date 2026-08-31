// ============================================================
// Scheduled-broadcast drain helpers.
//
// A wizard campaign with status `scheduled` sits idle until
// GET /api/whatsapp/broadcast/cron picks it up. These functions are
// the claim protocol: find one due row, take the delivery lock while
// it is still `scheduled`, then flip to `sending` only after a plan
// is ready. The status guard on the flip is what lets Cancel win
// over a drain that has already claimed the lock.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { DELIVERY_LOCK_STALE_MS } from '@/lib/whatsapp/broadcast-resume';

export interface DueScheduledBroadcast {
  id: string;
  account_id: string;
}

function staleCutoffIso(now: Date): string {
  return new Date(now.getTime() - DELIVERY_LOCK_STALE_MS).toISOString();
}

/**
 * Oldest due scheduled campaign whose delivery lock is free (or
 * abandoned). Limit 1 — one campaign per cron tick so overlapping
 * pings don't stack Meta rate-limit pressure.
 */
export async function findDueScheduledBroadcast(
  db: SupabaseClient,
  now: Date = new Date()
): Promise<DueScheduledBroadcast | null> {
  const { data, error } = await db
    .from('broadcasts')
    .select('id, account_id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now.toISOString())
    .or(
      `delivery_locked_at.is.null,delivery_locked_at.lt.${staleCutoffIso(now)}`
    )
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[broadcast-schedule] due lookup failed:', error.message);
    return null;
  }
  if (!data) return null;
  return { id: data.id as string, account_id: data.account_id as string };
}

/**
 * Take the delivery lock on a still-scheduled row. Does not flip
 * status — that happens in {@link markScheduledBroadcastSending}
 * after planning succeeds, so a Cancel (status → draft) still wins
 * if it lands between claim and flip.
 *
 * Returns the row when the conditional UPDATE matched, otherwise
 * null (already locked, cancelled, or not scheduled).
 */
export async function claimScheduledBroadcast(
  db: SupabaseClient,
  broadcastId: string,
  now: Date = new Date()
): Promise<DueScheduledBroadcast | null> {
  const { data, error } = await db
    .from('broadcasts')
    .update({
      delivery_locked_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', broadcastId)
    .eq('status', 'scheduled')
    .or(
      `delivery_locked_at.is.null,delivery_locked_at.lt.${staleCutoffIso(now)}`
    )
    .select('id, account_id')
    .maybeSingle();

  if (error) {
    console.error('[broadcast-schedule] claim failed:', error.message);
    return null;
  }
  if (!data) return null;
  return { id: data.id as string, account_id: data.account_id as string };
}

/**
 * Flip a claimed scheduled row to `sending`. Returns false when the
 * row is no longer `scheduled` (Cancel landed first) — the caller
 * must release the lock and skip delivery.
 */
export async function markScheduledBroadcastSending(
  db: SupabaseClient,
  broadcastId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('broadcasts')
    .update({
      status: 'sending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', broadcastId)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error(
      '[broadcast-schedule] mark sending failed:',
      error.message
    );
    return false;
  }
  return Boolean(data?.id);
}
