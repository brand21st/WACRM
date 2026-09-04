import { afterEach, describe, expect, it } from 'vitest'

import { getBullmqConnection, isRedisConfigured, parseRedisUrl } from './redis'

const ORIGINAL_REDIS_URL = process.env.REDIS_URL

afterEach(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL
})

describe('parseRedisUrl', () => {
  it('parses host, port, auth, and db', () => {
    expect(parseRedisUrl('redis://user:s%40cret@redis:6380/2')).toMatchObject({
      host: 'redis',
      port: 6380,
      username: 'user',
      password: 's@cret',
      db: 2,
      maxRetriesPerRequest: null,
    })
  })

  it('defaults port 6379 and enables TLS for rediss', () => {
    expect(parseRedisUrl('rediss://example.com')).toMatchObject({
      host: 'example.com',
      port: 6379,
      tls: {},
    })
  })

  it('rejects non-redis URLs', () => {
    expect(parseRedisUrl('http://example.com')).toBeNull()
    expect(parseRedisUrl('not a url')).toBeNull()
  })
})

describe('isRedisConfigured / getBullmqConnection', () => {
  it('is false when REDIS_URL is unset', () => {
    delete process.env.REDIS_URL
    expect(isRedisConfigured()).toBe(false)
    expect(getBullmqConnection()).toBeNull()
  })

  it('returns connection options from REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:6379'
    expect(isRedisConfigured()).toBe(true)
    expect(getBullmqConnection()).toMatchObject({
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null,
    })
  })
})
