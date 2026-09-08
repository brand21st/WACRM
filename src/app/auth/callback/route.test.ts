import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const exchangeCodeForSession = vi.fn()
const cookieWrites: Array<{ name: string; value: string }> = []

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: {
        setAll: (
          cookies: Array<{
            name: string
            value: string
            options: Record<string, unknown>
          }>,
        ) => void
      }
    },
  ) => ({
    auth: {
      exchangeCodeForSession: async (code: string) => {
        const result = await exchangeCodeForSession(code)
        if (!result.error) {
          opts.cookies.setAll([
            { name: 'sb-access', value: 'tok', options: { path: '/' } },
          ])
        }
        return result
      },
    },
  }),
}))

import { GET } from './route'

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  exchangeCodeForSession.mockReset()
  cookieWrites.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /auth/callback', () => {
  it('redirects to login when the provider returns an error', async () => {
    const res = await GET(
      new NextRequest(
        'https://app.test/auth/callback?error=access_denied',
      ),
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login?error=access_denied')
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('redirects to login when the code is missing', async () => {
    const res = await GET(new NextRequest('https://app.test/auth/callback'))
    expect(res.headers.get('location')).toContain('error=missing_code')
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('exchanges the code and redirects to a safe next path', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { app_metadata: {} } },
      error: null,
    })
    const res = await GET(
      new NextRequest(
        'https://app.test/auth/callback?code=abc&next=%2Fdashboard',
      ),
    )
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc')
    expect(res.headers.get('location')).toBe('https://app.test/dashboard')
    expect(res.cookies.get('sb-access')?.value).toBe('tok')
  })

  it('rejects an off-site next and lands on dashboard', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { app_metadata: {} } },
      error: null,
    })
    const res = await GET(
      new NextRequest(
        'https://app.test/auth/callback?code=abc&next=https://evil.example',
      ),
    )
    expect(res.headers.get('location')).toBe('https://app.test/dashboard')
  })

  it('sends a failed exchange to login', async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'bad code' },
    })
    const res = await GET(
      new NextRequest('https://app.test/auth/callback?code=nope'),
    )
    expect(res.headers.get('location')).toContain('error=exchange_failed')
  })
})
