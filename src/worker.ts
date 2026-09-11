import { createQueueWorkers } from '@/lib/queue/create-workers'
import { parseWorkerGroup, type QueueName } from '@/lib/queue/names'
import { startWorkerHeartbeat } from '@/lib/queue/queue-health'
import { getBullmqConnection, getRedisUrl } from '@/lib/queue/redis'

async function main() {
  const connection = getBullmqConnection()
  const redisUrl = getRedisUrl()
  if (!connection || !redisUrl) {
    console.error('[worker] REDIS_URL is required')
    process.exit(1)
  }

  const group = parseWorkerGroup(process.env.WORKER_GROUP)
  const workers = createQueueWorkers(connection, group)
  const heartbeat = startWorkerHeartbeat(
    redisUrl,
    group,
    workers.map((worker) => worker.name as QueueName),
  )

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      console.error(
        `[worker] ${worker.name} job ${job?.id} failed:`,
        err instanceof Error ? err.message : err,
      )
    })
    worker.on('error', (err) => {
      console.error(`[worker] ${worker.name}:`, err.message)
    })
    worker.on('stalled', (jobId) => {
      console.warn(`[worker] ${worker.name} stalled:`, jobId)
    })
  }

  console.info(
    `[worker] ${group} group listening on`,
    workers.map((w) => w.name).join(', '),
  )

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.info(`[worker] ${signal} — closing`)
    await heartbeat.stop()
    await Promise.all(workers.map((w) => w.close()))
    process.exit(0)
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
}

void main()
