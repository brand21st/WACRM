import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { processMetaWebhookPayload } from '@/lib/meta/webhook'
import { getWebhookAppSecrets } from '@/lib/whatsapp/webhook-app-secrets'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { decrypt } from '@/lib/whatsapp/encryption'

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function supabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  if (mode !== 'subscribe' || !token || !challenge) {
    return NextResponse.json({ error: 'Bad verification request' }, { status: 400 })
  }

  const envToken =
    process.env.META_WEBHOOK_VERIFY_TOKEN ||
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
  if (envToken && token === envToken) {
    return new NextResponse(challenge, { status: 200 })
  }

  const { data } = await supabaseAdmin()
    .from('meta_page_connections')
    .select('verify_token')
    .not('verify_token', 'is', null)
  for (const row of data ?? []) {
    if (!row.verify_token) continue
    try {
      if (decrypt(row.verify_token) === token || row.verify_token === token) {
        return new NextResponse(challenge, { status: 200 })
      }
    } catch {
      if (row.verify_token === token) {
        return new NextResponse(challenge, { status: 200 })
      }
    }
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const secrets = await getWebhookAppSecrets()
  if (!verifyMetaWebhookSignature(rawBody, signature, secrets)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { object?: string; entry?: unknown[] }
  try {
    body = JSON.parse(rawBody) as { object?: string; entry?: unknown[] }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  after(async () => {
    try {
      await processMetaWebhookPayload(body as Parameters<typeof processMetaWebhookPayload>[0])
    } catch (err) {
      console.error('[meta/webhook] process failed:', err)
    }
  })

  return NextResponse.json({ ok: true })
}
