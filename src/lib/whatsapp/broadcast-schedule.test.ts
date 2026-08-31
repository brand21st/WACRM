import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  claimScheduledBroadcast,
  findDueScheduledBroadcast,
  markScheduledBroadcastSending,
} from './broadcast-schedule';

interface QueryCall {
  table?: string;
  update?: Record<string, unknown>;
  filters: Record<string, unknown>;
  or?: string;
  order?: { col: string; opts: unknown };
  limit?: number;
  select?: string;
}

function dueDb(
  returned: unknown,
  calls: QueryCall[],
  error: { message: string } | null = null,
): SupabaseClient {
  return {
    from(table: string) {
      const call: QueryCall = { table, filters: {} };
      calls.push(call);
      const b: Record<string, unknown> = {
        select: (cols: string) => {
          call.select = cols;
          return b;
        },
        eq: (col: string, val: unknown) => {
          call.filters[col] = val;
          return b;
        },
        lte: (col: string, val: unknown) => {
          call.filters[col] = val;
          return b;
        },
        or: (expr: string) => {
          call.or = expr;
          return b;
        },
        order: (col: string, opts: unknown) => {
          call.order = { col, opts };
          return b;
        },
        limit: (n: number) => {
          call.limit = n;
          return b;
        },
        maybeSingle: async () => ({ data: returned, error }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

function claimDb(
  returned: unknown,
  calls: QueryCall[],
  error: { message: string } | null = null,
): SupabaseClient {
  return {
    from() {
      const call: QueryCall = { filters: {} };
      const b: Record<string, unknown> = {
        update: (row: Record<string, unknown>) => {
          call.update = row;
          calls.push(call);
          return b;
        },
        eq: (col: string, val: unknown) => {
          call.filters[col] = val;
          return b;
        },
        or: (expr: string) => {
          call.or = expr;
          return b;
        },
        select: (cols: string) => {
          call.select = cols;
          return b;
        },
        maybeSingle: async () => ({ data: returned, error }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('findDueScheduledBroadcast', () => {
  it('selects the oldest due scheduled row that is unlocked', async () => {
    const calls: QueryCall[] = [];
    const row = await findDueScheduledBroadcast(
      dueDb({ id: 'bc-1', account_id: 'acct-1' }, calls),
      new Date('2026-08-26T12:00:00Z'),
    );

    expect(row).toEqual({ id: 'bc-1', account_id: 'acct-1' });
    expect(calls[0].filters.status).toBe('scheduled');
    expect(calls[0].filters.scheduled_at).toBe('2026-08-26T12:00:00.000Z');
    expect(calls[0].or).toBe(
      'delivery_locked_at.is.null,delivery_locked_at.lt.2026-08-26T11:30:00.000Z',
    );
    expect(calls[0].order).toEqual({
      col: 'scheduled_at',
      opts: { ascending: true },
    });
    expect(calls[0].limit).toBe(1);
  });

  it('returns null when nothing is due', async () => {
    const row = await findDueScheduledBroadcast(dueDb(null, []));
    expect(row).toBeNull();
  });

  it('returns null when the lookup errors rather than throwing', async () => {
    const row = await findDueScheduledBroadcast(
      dueDb(null, [], { message: 'boom' }),
    );
    expect(row).toBeNull();
  });
});

describe('claimScheduledBroadcast', () => {
  it('locks a still-scheduled row without flipping status', async () => {
    const calls: QueryCall[] = [];
    const claimed = await claimScheduledBroadcast(
      claimDb({ id: 'bc-1', account_id: 'acct-1' }, calls),
      'bc-1',
      new Date('2026-08-26T12:00:00Z'),
    );

    expect(claimed).toEqual({ id: 'bc-1', account_id: 'acct-1' });
    expect(calls[0].filters).toEqual({ id: 'bc-1', status: 'scheduled' });
    expect(calls[0].update?.status).toBeUndefined();
    expect(calls[0].update?.delivery_locked_at).toBe(
      '2026-08-26T12:00:00.000Z',
    );
    expect(calls[0].or).toBe(
      'delivery_locked_at.is.null,delivery_locked_at.lt.2026-08-26T11:30:00.000Z',
    );
  });

  it('returns null when Cancel or another drain already won', async () => {
    const claimed = await claimScheduledBroadcast(claimDb(null, []), 'bc-1');
    expect(claimed).toBeNull();
  });
});

describe('markScheduledBroadcastSending', () => {
  it('flips only while the row is still scheduled', async () => {
    const calls: QueryCall[] = [];
    const ok = await markScheduledBroadcastSending(
      claimDb({ id: 'bc-1' }, calls),
      'bc-1',
    );
    expect(ok).toBe(true);
    expect(calls[0].filters).toEqual({ id: 'bc-1', status: 'scheduled' });
    expect(calls[0].update?.status).toBe('sending');
  });

  it('returns false when Cancel already moved it off scheduled', async () => {
    const ok = await markScheduledBroadcastSending(claimDb(null, []), 'bc-1');
    expect(ok).toBe(false);
  });
});
