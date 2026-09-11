import { randomUUID } from 'node:crypto'

import { Queue } from 'bullmq'
import Redis from 'ioredis'

import {
  QUEUE_WORKER_GROUP,
  QUEUE_NAMES,
  type QueueName,
  type WorkerGroup,
} from '@/lib/queue/names'
import { getBullmqConnection, getRedisUrl } from '@/lib/queue/redis'

const HEARTBEAT_PREFIX = 'wacrm:worker-heartbeat'
const HEARTBEAT_INTERVAL_MS = 15_000
const HEARTBEAT_TTL_SECONDS = 45
const MONITORED_STATES = ['waiting', 'active', 'delayed', 'failed'] as const

type MonitoredState = (typeof MONITORED_STATES)[number]

type QueueJobSummary = {
  timestamp: number
  delay?: number
  processedOn?: number
  finishedOn?: number
}

export type QueueOperationsItem = {
  name: QueueName
  group: Exclude<WorkerGroup, 'all'>
  counts: Record<MonitoredState | 'completed', number>
  oldest_age_seconds: Record<MonitoredState, number | null>
}

export type QueueOperationsHealth = {
  available: boolean
  scope: 'deployment'
  checked_at: string
  worker_heartbeats: Array<{
    group: WorkerGroup
    queue_names: QueueName[]
    last_seen_at: string
    age_seconds: number
    healthy: boolean
  }>
  queues: QueueOperationsItem[]
  error?: 'redis_not_configured' | 'queue_unavailable'
}

type HealthQueue = {
  name: string
  getJobCounts: (
    ...states: Array<MonitoredState | 'completed'>
  ) => Promise<Record<string, number>>
  getJobs: (
    state: MonitoredState,
    start: number,
    end: number,
    ascending: boolean,
  ) => Promise<QueueJobSummary[]>
  close: () => Promise<void>
}

type StoredHeartbeat = {
  group: WorkerGroup
  queue_names: QueueName[]
  last_seen_at: string
}

function queueGroup(name: QueueName): Exclude<WorkerGroup, 'all'> {
  return QUEUE_WORKER_GROUP[name]
}

function ageSeconds(timestamp: number | undefined, now: number): number | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null
  return Math.max(0, Math.floor((now - timestamp) / 1000))
}

function stateTimestamp(
  job: QueueJobSummary | undefined,
  state: MonitoredState,
): number | undefined {
  if (!job) return undefined
  if (state === 'active') return job.processedOn ?? job.timestamp
  if (state === 'failed') return job.finishedOn ?? job.timestamp
  if (state === 'delayed') return job.timestamp + (job.delay ?? 0)
  return job.timestamp
}

export async function collectQueueOperations(
  queues: HealthQueue[],
  heartbeats: StoredHeartbeat[],
  now = Date.now(),
): Promise<QueueOperationsHealth> {
  const queueItems = await Promise.all(
    queues.map(async (queue) => {
      const [counts, oldestJobs] = await Promise.all([
        queue.getJobCounts(...MONITORED_STATES, 'completed'),
        Promise.all(
          MONITORED_STATES.map((state) => queue.getJobs(state, 0, 0, true)),
        ),
      ])
      const name = queue.name as QueueName
      const oldest_age_seconds = Object.fromEntries(
        MONITORED_STATES.map((state, index) => [
          state,
          ageSeconds(stateTimestamp(oldestJobs[index][0], state), now),
        ]),
      ) as QueueOperationsItem['oldest_age_seconds']

      return {
        name,
        group: queueGroup(name),
        counts: {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
        },
        oldest_age_seconds,
      }
    }),
  )

  return {
    available: true,
    scope: 'deployment',
    checked_at: new Date(now).toISOString(),
    worker_heartbeats: heartbeats.map((heartbeat) => {
      const age = ageSeconds(Date.parse(heartbeat.last_seen_at), now) ?? 0
      return {
        ...heartbeat,
        age_seconds: age,
        healthy: age <= HEARTBEAT_TTL_SECONDS,
      }
    }),
    queues: queueItems,
  }
}

async function readHeartbeats(redis: Redis): Promise<StoredHeartbeat[]> {
  let cursor = '0'
  const keys: string[] = []
  do {
    const [nextCursor, page] = await redis.scan(
      cursor,
      'MATCH',
      `${HEARTBEAT_PREFIX}:*`,
      'COUNT',
      100,
    )
    cursor = nextCursor
    keys.push(...page)
  } while (cursor !== '0')

  if (keys.length === 0) return []
  const values = await redis.mget(...keys)
  return values.flatMap((value) => {
    if (!value) return []
    try {
      const parsed = JSON.parse(value) as StoredHeartbeat
      if (
        typeof parsed.last_seen_at !== 'string' ||
        !Array.isArray(parsed.queue_names)
      ) {
        return []
      }
      return [parsed]
    } catch {
      return []
    }
  })
}

export async function loadQueueOperationsHealth(): Promise<QueueOperationsHealth> {
  const connection = getBullmqConnection()
  const redisUrl = getRedisUrl()
  const checkedAt = new Date().toISOString()
  if (!connection || !redisUrl) {
    return {
      available: false,
      scope: 'deployment',
      checked_at: checkedAt,
      worker_heartbeats: [],
      queues: [],
      error: 'redis_not_configured',
    }
  }

  const queues = Object.values(QUEUE_NAMES).map(
    (name) => new Queue(name, { connection }),
  )
  const redis = new Redis(redisUrl, {
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
  })
  try {
    const heartbeats = await readHeartbeats(redis)
    return await collectQueueOperations(queues, heartbeats)
  } catch (error) {
    console.error(
      '[queue-health] collection failed:',
      error instanceof Error ? error.message : error,
    )
    return {
      available: false,
      scope: 'deployment',
      checked_at: checkedAt,
      worker_heartbeats: [],
      queues: [],
      error: 'queue_unavailable',
    }
  } finally {
    await Promise.allSettled(queues.map((queue) => queue.close()))
    await redis.quit().catch(() => undefined)
  }
}

export type WorkerHeartbeat = {
  stop: () => Promise<void>
}

export function startWorkerHeartbeat(
  redisUrl: string,
  group: WorkerGroup,
  queueNames: QueueName[],
): WorkerHeartbeat {
  const redis = new Redis(redisUrl, {
    connectTimeout: 3_000,
    maxRetriesPerRequest: 1,
  })
  const key = `${HEARTBEAT_PREFIX}:${randomUUID()}`
  let stopped = false

  const write = async () => {
    if (stopped) return
    const heartbeat: StoredHeartbeat = {
      group,
      queue_names: queueNames,
      last_seen_at: new Date().toISOString(),
    }
    try {
      await redis.set(
        key,
        JSON.stringify(heartbeat),
        'EX',
        HEARTBEAT_TTL_SECONDS,
      )
    } catch (error) {
      console.warn(
        '[worker] heartbeat failed:',
        error instanceof Error ? error.message : error,
      )
    }
  }

  void write()
  const timer = setInterval(() => void write(), HEARTBEAT_INTERVAL_MS)
  timer.unref()

  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      await redis.del(key).catch(() => undefined)
      await redis.quit().catch(() => undefined)
    },
  }
}

