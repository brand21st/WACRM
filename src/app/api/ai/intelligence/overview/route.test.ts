import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadIntelligenceOverview: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ mocked: true }),
}))

vi.mock('@/lib/ai/intelligence/ai-intelligence-admin', () => ({
  loadIntelligenceOverview: mocks.loadIntelligenceOverview,
}))

import { ForbiddenError } from '@/lib/auth/account'
import { GET } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.loadIntelligenceOverview.mockReset()
})

describe('GET /api/ai/intelligence/overview', () => {
  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError())
    const res = await GET()
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(JSON.stringify(body)).not.toMatch(/sales_patterns|supabase/i)
  })

  it('scopes the overview to the caller account', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'u1' })
    mocks.loadIntelligenceOverview.mockResolvedValue({
      knowledge: { available: true, document_count: 2, last_updated_at: null },
      patterns: {
        available: true,
        by_status: { candidate: 0, active: 1, stale: 0, archived: 0 },
        retrieval_eligible_count: 1,
        with_effectiveness_count: 0,
        underperforming_count: 0,
        last_observed_at: null,
      },
      experiments: { available: true, by_status: { draft: 0 } },
      flags: {
        sales_pattern_retrieval: 'off',
        ai_behavior_optimization: 'off',
      },
    })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(mocks.loadIntelligenceOverview).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
    )
  })

  it('returns unavailable blocks without leaking schema', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'u1' })
    mocks.loadIntelligenceOverview.mockResolvedValue({
      knowledge: { available: false, document_count: 0, last_updated_at: null },
      patterns: {
        available: false,
        by_status: { candidate: 0, active: 0, stale: 0, archived: 0 },
        retrieval_eligible_count: 0,
        with_effectiveness_count: 0,
        underperforming_count: 0,
        last_observed_at: null,
      },
      experiments: { available: true, by_status: { draft: 0 } },
      flags: {
        sales_pattern_retrieval: 'off',
        ai_behavior_optimization: 'off',
      },
    })
    const res = await GET()
    const body = await res.json()
    expect(body.patterns.available).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/relation|42P01|PGRST205/i)
  })
})
