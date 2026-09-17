import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  claimed: null as { account_id: string } | null,
  upsertError: null as { code?: string; message?: string } | null,
  subscribeError: null as Error | null,
  updates: [] as Record<string, unknown>[],
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from() {
      return {
        select: () => ({
          eq: () => ({
            neq: () => ({
              maybeSingle: async () => ({ data: h.claimed, error: null }),
            }),
          }),
        }),
        upsert: async () => ({ error: h.upsertError }),
        update: (row: Record<string, unknown>) => {
          h.updates.push(row)
          return { eq: async () => ({ error: null }) }
        },
      }
    },
  }),
}))

vi.mock('@/lib/meta/graph', () => ({
  getPageInstagramAccount: async () => ({
    pageId: 'page-1',
    pageName: 'Acme',
    igUserId: 'ig-1',
    igUsername: 'acme',
  }),
  subscribePageApps: async () => {
    if (h.subscribeError) throw h.subscribeError
  },
  exchangeLoginCode: vi.fn(),
  extendUserToken: vi.fn(),
  listUserPages: vi.fn(),
  getPageToken: vi.fn(),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (value: string) => `enc:${value}`,
}))

vi.mock('@/lib/whatsapp/webhook-app-secrets', () => ({
  invalidateWebhookAppSecretsCache: vi.fn(),
}))

import {
  extendUserToken,
  listUserPages,
} from '@/lib/meta/graph'
import {
  connectFromUserToken,
  persistPageConnection,
  MetaConnectError,
} from '@/lib/meta/connect'

describe('persistPageConnection', () => {
  beforeEach(() => {
    h.claimed = null
    h.upsertError = null
    h.subscribeError = null
    h.updates = []
  })

  it('returns 409 when another account already has this page_id', async () => {
    h.claimed = { account_id: 'other-acct' }
    await expect(
      persistPageConnection({
        accountId: 'acct-1',
        userId: 'user-1',
        pageId: 'page-1',
        pageAccessToken: 'token',
        onboardingSource: 'manual',
      }),
    ).rejects.toMatchObject({
      name: 'MetaConnectError',
      status: 409,
      code: 'page_in_use',
    })
    expect(MetaConnectError).toBeDefined()
  })

  it('keeps the row connected when subscribed_apps fails after save', async () => {
    h.subscribeError = new Error('subscribe failed')
    const result = await persistPageConnection({
      accountId: 'acct-1',
      userId: 'user-1',
      pageId: 'page-1',
      pageAccessToken: 'token',
      onboardingSource: 'manual',
    })
    expect(result.messengerStatus).toBe('connected')
    expect(result.instagramStatus).toBe('connected')
    expect(result.subscribedAppsAt).toBeNull()
    expect(result.lastError).toBe('subscribe failed')
    expect(h.updates.some((row) => row.last_error === 'subscribe failed')).toBe(
      true,
    )
  })
})

describe('connectFromUserToken', () => {
  beforeEach(() => {
    h.claimed = null
    h.upsertError = null
    h.subscribeError = null
    h.updates = []
    vi.mocked(extendUserToken).mockResolvedValue({ accessToken: 'long-token' })
    vi.mocked(listUserPages).mockResolvedValue([
      { id: 'page-1', name: 'Acme', access_token: 'page-token' },
    ])
  })

  it('persists the first Facebook Page from a user token', async () => {
    const result = await connectFromUserToken({
      accountId: 'acct-1',
      userId: 'user-1',
      userAccessToken: 'short-token',
    })
    expect(result.pageId).toBe('page-1')
    expect(result.messengerStatus).toBe('connected')
    expect(extendUserToken).toHaveBeenCalledWith({
      shortLivedToken: 'short-token',
    })
    expect(listUserPages).toHaveBeenCalledWith({
      userAccessToken: 'long-token',
    })
  })

  it('returns no_pages when the user has no Facebook Pages', async () => {
    vi.mocked(listUserPages).mockResolvedValue([])
    await expect(
      connectFromUserToken({
        accountId: 'acct-1',
        userId: 'user-1',
        userAccessToken: 'short-token',
      }),
    ).rejects.toMatchObject({
      name: 'MetaConnectError',
      status: 400,
      code: 'no_pages',
    })
  })
})
