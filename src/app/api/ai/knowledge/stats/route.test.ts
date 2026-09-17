import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  loadEmbeddingsKey: vi.fn(),
}))

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>(
    '@/lib/auth/account',
  )
  return {
    ...actual,
    getCurrentAccount: mocks.getCurrentAccount,
  }
})

vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsKey: (...args: unknown[]) => mocks.loadEmbeddingsKey(...args),
}))

import { GET } from './route'

function chain(rows: unknown[]) {
  const api = {
    eq: vi.fn(),
    range: vi.fn(),
  }
  api.eq.mockReturnValue(api)
  api.range.mockResolvedValue({ data: rows, error: null })
  return api
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset()
  mocks.loadEmbeddingsKey.mockReset()
  mocks.loadEmbeddingsKey.mockResolvedValue({ key: null, corrupt: false })
})

describe('GET /api/ai/knowledge/stats', () => {
  it('returns score and breakdown for indexed Shopify and manual sources', async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      accountId: 'acct-1',
      supabase: {
        from: (table: string) => ({
          select: () => {
            if (table === 'shopify_store_content') {
              return chain([
                {
                  kind: 'policy',
                  title: 'Refund policy',
                  body: 'Returns in 30 days.',
                },
              ])
            }
            if (table === 'shopify_catalog_products') {
              return chain([
                {
                  title: 'Teddy',
                  body: 'Soft plush toy.',
                  body_excerpt: 'Soft plush toy.',
                },
              ])
            }
            if (table === 'ai_knowledge_documents') {
              return chain([
                {
                  id: 'doc-1',
                  title: 'FAQ',
                  content: 'We ship worldwide.',
                  source_type: 'manual',
                },
              ])
            }
            if (table === 'ai_knowledge_chunks') {
              return chain([
                { document_id: 'doc-1', embedding: null },
                { document_id: 'doc-1', embedding: null },
              ])
            }
            return chain([])
          },
        }),
      },
    })

    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.score).toBeGreaterThan(0)
    expect(json.total_chunks).toBe(2)
    expect(json.breakdown).toHaveLength(5)
    expect(
      json.breakdown.find((row: { key: string }) => row.key === 'manual')
        ?.chunks,
    ).toBe(2)
  })
})
