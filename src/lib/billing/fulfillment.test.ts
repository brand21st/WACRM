import { describe, expect, it, vi } from 'vitest'

describe('fulfillRazorpayEvent', () => {
  it('writes current_period_start and clears HOLD on paid activation', async () => {
    vi.resetModules()
    const updates: Array<{ table: string; row: Record<string, unknown> }> = []
    vi.doMock('@/lib/ai/admin-client', () => ({
      supabaseAdmin: () => ({
        from: (table: string) => {
          if (table === 'account_subscriptions') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: 'sub-1' }, error: null }),
                }),
              }),
              update: (row: Record<string, unknown>) => {
                updates.push({ table, row })
                return { eq: async () => ({ error: null }) }
              },
            }
          }
          return {
            update: (row: Record<string, unknown>) => {
              updates.push({ table, row })
              return {
                eq: () => ({
                  eq: async () => ({ error: null }),
                }),
              }
            },
          }
        },
      }),
    }))

    const { fulfillRazorpayEvent } = await import('./fulfillment')
    await fulfillRazorpayEvent('subscription.charged', {
      payload: {
        subscription: {
          entity: {
            id: 'sub_rzp',
            status: 'active',
            current_start: 1757030400,
            current_end: 1764547200,
            notes: { account_id: 'acc-1', package_id: 'pkg-1' },
          },
        },
      },
    })

    const subUpdate = updates.find((u) => u.table === 'account_subscriptions')
    expect(subUpdate?.row.current_period_start).toBe('2025-09-05T00:00:00.000Z')
    expect(updates.some((u) => u.table === 'accounts' && u.row.status === 'active')).toBe(
      true,
    )
  })
})
