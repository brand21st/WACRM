import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntelligenceApiError, approveExperiment, fetchOverview } from './api'
import { PERMISSION_COPY } from './view-model'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI Intelligence API client', () => {
  it('maps 403 to the permission toast copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
      ),
    )
    await expect(approveExperiment('e1')).rejects.toMatchObject({
      name: 'IntelligenceApiError',
      status: 403,
      message: PERMISSION_COPY,
    })
  })

  it('never surfaces SQL or table names from 500s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'relation "sales_patterns" does not exist',
          }),
          { status: 500 },
        ),
      ),
    )
    await expect(fetchOverview()).rejects.toBeInstanceOf(IntelligenceApiError)
    await expect(fetchOverview()).rejects.toMatchObject({
      message: 'Something went wrong. Please try again.',
    })
  })
})
