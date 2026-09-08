import { beforeEach, describe, expect, it, vi } from 'vitest'

const scheduleCatalogEmbed = vi.fn().mockResolvedValue(undefined)

vi.mock('./jobs', () => ({
  scheduleCatalogEmbed: (...args: unknown[]) => scheduleCatalogEmbed(...args),
}))

import { intelSeed } from '../intelligence/facts.test'
import { createCatalogMemoryDb } from '../search/memory-db'
import { enqueueCatalogEmbedBackfill } from './backfill'

describe('enqueueCatalogEmbedBackfill', () => {
  beforeEach(() => {
    scheduleCatalogEmbed.mockReset().mockResolvedValue(undefined)
  })

  it('enqueues every account product and skips the other shop', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await enqueueCatalogEmbedBackfill(db, 'acct-a')
    expect(result.enqueued).toBe(5)
    expect(scheduleCatalogEmbed).toHaveBeenCalledTimes(5)
    expect(
      scheduleCatalogEmbed.mock.calls.every((call) => call[1] === 'acct-a'),
    ).toBe(true)
  })
})
