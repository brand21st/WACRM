import type { ConnectionOptions } from 'bullmq'

/**
 * BullMQ connection options (not a shared ioredis instance).
 * Workers use blocking Redis commands, so BullMQ must own the sockets.
 */

export function getRedisUrl(): string | undefined {
  const url = process.env.REDIS_URL?.trim()
  return url || undefined
}

export function isRedisConfigured(): boolean {
  return Boolean(getRedisUrl())
}

export function parseRedisUrl(url: string): ConnectionOptions | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    return null
  }
  const port = parsed.port ? Number(parsed.port) : 6379
  if (!Number.isFinite(port) || port <= 0) return null

  const opts: {
    host: string
    port: number
    maxRetriesPerRequest: null
    username?: string
    password?: string
    tls?: Record<string, never>
    db?: number
  } = {
    host: parsed.hostname || '127.0.0.1',
    port,
    maxRetriesPerRequest: null,
  }
  if (parsed.username) opts.username = decodeURIComponent(parsed.username)
  if (parsed.password) opts.password = decodeURIComponent(parsed.password)
  if (parsed.protocol === 'rediss:') opts.tls = {}
  const db = parsed.pathname.replace(/^\//, '')
  if (db && /^\d+$/.test(db)) opts.db = Number(db)
  return opts
}

export function getBullmqConnection(): ConnectionOptions | null {
  const url = getRedisUrl()
  if (!url) return null
  const opts = parseRedisUrl(url)
  if (!opts) {
    console.error('[redis] invalid REDIS_URL')
    return null
  }
  return opts
}
