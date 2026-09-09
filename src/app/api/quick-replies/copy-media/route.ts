import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { mediaFilename } from '@/lib/media/filename'
import { isMediaQuickReplyKind } from '@/lib/quick-replies'
import {
  buildMediaPath,
  CHAT_MEDIA_BUCKET,
  MEDIA_MAX_BYTES,
} from '@/lib/storage/upload-media'
import type { Message } from '@/types'

/**
 * Copy a thread attachment into a new chat-media object for a quick
 * reply. Browser fetch hits CORS on Shopify CDN (and some CDNs); the
 * URL is taken from the caller's own message row so this is not an
 * open SSRF proxy.
 */
export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as {
    message_id?: unknown
  } | null
  const messageId =
    typeof body?.message_id === 'string' ? body.message_id.trim() : ''
  if (!messageId) {
    return NextResponse.json({ error: 'message_id is required' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: row, error } = await admin
    .from('messages')
    .select('*')
    .eq('id', messageId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!row) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  const { data: conv } = await admin
    .from('conversations')
    .select('account_id')
    .eq('id', row.conversation_id)
    .maybeSingle()
  if (conv?.account_id !== ctx.accountId) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  const message = row as Message
  if (!isMediaQuickReplyKind(message.content_type) || !message.media_url?.trim()) {
    return NextResponse.json(
      { error: 'This message has no file to copy' },
      { status: 400 },
    )
  }

  const sourceUrl = resolveMediaUrl(message.media_url.trim(), request)
  const filename = mediaFilename({
    content_type: message.content_type,
    content_text: message.content_text,
    media_url: message.media_url,
    media_type: message.media_type,
    created_at: message.created_at,
  })

  const headers: HeadersInit = {}
  try {
    const origin = new URL(request.url).origin
    if (sourceUrl.startsWith(origin)) {
      const cookie = request.headers.get('cookie')
      if (cookie) headers.cookie = cookie
    }
  } catch {
    // ignore
  }

  let downloaded: Response
  try {
    downloaded = await fetch(sourceUrl, { headers })
  } catch {
    return NextResponse.json(
      { error: 'This attachment is no longer available.' },
      { status: 502 },
    )
  }
  if (!downloaded.ok) {
    return NextResponse.json(
      { error: 'This attachment is no longer available.' },
      { status: 502 },
    )
  }

  const buf = new Uint8Array(await downloaded.arrayBuffer())
  if (buf.byteLength === 0 || buf.byteLength > MEDIA_MAX_BYTES) {
    return NextResponse.json(
      { error: 'This attachment is no longer available.' },
      { status: 400 },
    )
  }

  const contentType =
    (downloaded.headers.get('content-type') || '').split(';')[0].trim() ||
    message.media_type ||
    'application/octet-stream'
  const path = buildMediaPath(ctx.accountId, filename)

  const { error: upErr } = await admin.storage
    .from(CHAT_MEDIA_BUCKET)
    .upload(path, buf, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    })
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 })
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)

  if (!publicUrl) {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  return NextResponse.json({ publicUrl, path, filename })
}

function resolveMediaUrl(url: string, request: Request): string {
  if (/^https?:\/\//i.test(url)) return url
  try {
    return new URL(url, new URL(request.url).origin).toString()
  } catch {
    return url
  }
}
