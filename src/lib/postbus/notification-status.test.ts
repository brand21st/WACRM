import { describe, expect, it, vi } from 'vitest'

import { applyPostBusNotificationStatus } from './notification-status'

describe('applyPostBusNotificationStatus', () => {
  it('updates a matching row and returns extras', async () => {
    const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 'n-1',
                status: 'sent',
                external_ref: 'postbus:booked:s1',
                notification_type: 'booked',
                merchant_id: 'org-1',
                message_id: 'msg-uuid',
              },
              error: null,
            }),
          }),
        }),
        update,
      }),
    }
    const extras = await applyPostBusNotificationStatus(
      db as never,
      'wamid-1',
      'delivered',
      'msg-uuid',
    )
    expect(extras.external_ref).toBe('postbus:booked:s1')
    expect(extras.notification_type).toBe('booked')
    expect(extras.merchant_id).toBe('org-1')
    expect(extras.message_id).toBe('msg-uuid')
    expect(update).toHaveBeenCalled()
  })

  it('returns empty extras when no row matches', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }
    const extras = await applyPostBusNotificationStatus(
      db as never,
      'wamid-none',
      'delivered',
      'msg-none',
    )
    expect(extras).toEqual({})
  })
})
