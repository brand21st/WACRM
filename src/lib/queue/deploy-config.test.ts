import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('deploy nginx', () => {
  const conf = readFileSync(
    join(process.cwd(), 'deploy/nginx/conf.d/wacrm.conf'),
    'utf8',
  )
  const main = readFileSync(
    join(process.cwd(), 'deploy/nginx/nginx.conf'),
    'utf8',
  )

  it('proxies the app and does not buffer Meta webhooks', () => {
    expect(conf).toContain('server app:3000')
    expect(conf).toContain('location /api/whatsapp/webhook')
    expect(conf).toContain('proxy_buffering off')
    expect(conf).toContain('proxy_request_buffering off')
    expect(main).toContain('client_max_body_size 20m')
    expect(main).toContain('server_tokens off')
  })

  it('forwards proto from an upstream TLS terminator', () => {
    expect(conf).toContain('X-Forwarded-Proto $forwarded_proto')
    expect(conf).toContain('map $http_x_forwarded_proto $forwarded_proto')
  })
})
