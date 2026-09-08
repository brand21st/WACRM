import { supabaseAdmin } from '@/lib/ai/admin-client'
import { drainDueConversationFollowUps } from '@/lib/ai/follow-up'
import { createQueueWorkers } from '@/lib/queue/create-workers'
import { getBullmqConnection } from '@/lib/queue/redis'

const FOLLOW_UP_DRAIN_MS = 30_000

async function drainFollowUps(): Promise<void> {
  try {
    const result = await drainDueConversationFollowUps(supabaseAdmin())
    if (result.processed > 0) {
      console.info('[worker] follow-up drain', result)
    }
  } catch (err) {
    console.error('[worker] follow-up drain failed:', err)
  }
}

async function main() {
  const connection = getBullmqConnection()
  if (!connection) {
    console.error('[worker] REDIS_URL is required')
    process.exit(1)
  }

  const workers = createQueueWorkers(connection)
  const followUpDrain = setInterval(() => {
    void drainFollowUps()
  }, FOLLOW_UP_DRAIN_MS)
  void drainFollowUps()

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
    clearInterval(followUpDrain)
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
