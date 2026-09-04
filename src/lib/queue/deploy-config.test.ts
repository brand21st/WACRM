import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

describe('deploy nginx', () => {
  const conf = readFileSync(
    join(root, 'deploy/nginx/conf.d/wacrm.conf'),
    'utf8',
  )
  const main = readFileSync(join(root, 'deploy/nginx/nginx.conf'), 'utf8')

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

describe('docker-compose Coolify contract', () => {
  const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
  const local = readFileSync(join(root, 'docker-compose.local.yml'), 'utf8')

  it('does not require a gitignored env file', () => {
    const withoutComments = compose
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    expect(withoutComments).not.toMatch(/env_file:/)
    expect(withoutComments).not.toContain('.env.local')
    expect(withoutComments).not.toMatch(/^name:/m)
  })

  it('pins Redis to the sidecar and refuses eviction', () => {
    expect(compose).toContain('REDIS_URL: redis://redis:6379')
    expect(compose).toContain('--maxmemory-policy noeviction')
    expect(compose).toContain('--appendonly yes')
    expect(compose).not.toMatch(/6379:6379/)
    expect(compose).not.toMatch(/["']6379["']/)
  })

  it('builds nginx from the image instead of bind-mounting git files', () => {
    expect(compose).toContain('context: ./deploy/nginx')
    expect(compose).not.toMatch(/nginx\.conf:\/etc\/nginx/)
  })

  it('exposes nginx to Coolify Traefik without binding host 80', () => {
    expect(compose).toMatch(/expose:\s*\n\s+- ['"]80['"]/)
    expect(compose).not.toMatch(/['"]80:80['"]/)
    expect(compose).not.toMatch(/HOST_PORT/)
    expect(compose).not.toMatch(/3000:80/)
  })

  it('lets Coolify inject runtime secrets instead of interpolating them at build', () => {
    expect(compose).not.toContain('${SUPABASE_SERVICE_ROLE_KEY}')
    expect(compose).not.toContain('${ENCRYPTION_KEY}')
    expect(compose).not.toContain('${META_APP_SECRET}')
  })

  it('healthchecks the public liveness route', () => {
    expect(compose).toContain("http://127.0.0.1:3000/api/health")
    expect(compose).toContain('http://127.0.0.1/api/health')
  })

  it('keeps laptop env and host port on the local overlay only', () => {
    expect(local).toContain('.env.local')
    expect(local).toContain('${HOST_PORT:-3000}:80')
  })
})
