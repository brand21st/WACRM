import { createQueueWorkers } from '@/lib/queue/create-workers'
import { getBullmqConnection } from '@/lib/queue/redis'

async function main() {
  const connection = getBullmqConnection()
  if (!connection) {
    console.error('[worker] REDIS_URL is required')
    process.exit(1)
  }

  const workers = createQueueWorkers(connection)

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
    '[worker] listening on',
    workers.map((w) => w.name).join(', '),
  )

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.info(`[worker] ${signal} — closing`)
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
