import { describe, expect, it, vi } from 'vitest'

import { collectQueueOperations } from './queue-health'

describe('collectQueueOperations', () => {
  it('reports counts and oldest ages without serializing job payloads', async () => {
    const now = Date.parse('2026-09-11T00:10:00.000Z')
    const queue = {
      name: 'ai-conversation-analyze',
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 2,
        active: 1,
        delayed: 1,
        failed: 3,
        completed: 4,
      }),
      getJobs: vi.fn().mockImplementation(async (state: string) => {
        if (state === 'waiting') {
          return [{ timestamp: now - 120_000, data: { secret: 'hidden' } }]
        }
        if (state === 'active') {
          return [{ timestamp: now - 90_000, processedOn: now - 30_000 }]
        }
        if (state === 'delayed') {
          return [{ timestamp: now - 60_000, delay: 120_000 }]
        }
        if (state === 'failed') {
          return [{ timestamp: now - 500_000, finishedOn: now - 300_000 }]
        }
        return []
      }),
      close: vi.fn(),
    }

    const health = await collectQueueOperations(
      [queue],
      [
        {
          group: 'learning',
          queue_names: ['ai-conversation-analyze'],
          last_seen_at: new Date(now - 10_000).toISOString(),
        },
      ],
      now,
    )

    expect(health.queues[0]).toMatchObject({
      name: 'ai-conversation-analyze',
      group: 'learning',
      counts: { waiting: 2, active: 1, delayed: 1, failed: 3, completed: 4 },
      oldest_age_seconds: {
        waiting: 120,
        active: 30,
        delayed: 0,
        failed: 300,
      },
    })
    expect(health.worker_heartbeats[0]).toMatchObject({
      group: 'learning',
      age_seconds: 10,
      healthy: true,
    })
    expect(JSON.stringify(health)).not.toContain('hidden')
  })

  it('marks expired heartbeats unhealthy', async () => {
    const now = Date.parse('2026-09-11T00:10:00.000Z')
    const health = await collectQueueOperations(
      [],
      [
        {
          group: 'customer',
          queue_names: ['ai-chat-reply'],
          last_seen_at: new Date(now - 46_000).toISOString(),
        },
      ],
      now,
    )

    expect(health.worker_heartbeats[0].healthy).toBe(false)
  })
})
