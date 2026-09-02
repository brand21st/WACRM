import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Call, CallingSettings } from '@/types'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { ensureCallingSettings } from '@/lib/calling/settings'
import {
  CALL_RECORDINGS_BUCKET,
  recordingContentType,
  recordingObjectPath,
} from '@/lib/calling/storage'
import { buildMediaPath } from '@/lib/storage/upload-media'
import { extensionForMime } from '@/lib/media/filename'
import { MIRROR_BUCKET } from '@/lib/whatsapp/mirror-inbound-media'
import { downloadWhatsAppMedia } from '@/lib/whatsapp/meta-api'

export function callRecordingMessageId(metaCallId: string): string {
  return `rec-${metaCallId}`
}

export function recordingHashesMatch(
  buffer: Buffer,
  expected?: string | null,
): boolean {
  if (!expected?.trim()) return true
  const digest = createHash('sha256').update(buffer).digest()
  const want = expected.trim()
  return (
    want === digest.toString('base64') || want.toLowerCase() === digest.toString('hex')
  )
}

export interface MetaCallRecordingAudio {
  id: string
  sha256?: string
  mime_type?: string
}

export async function persistMetaCallRecording(args: {
  db: SupabaseClient
  accountId: string
  metaCallId: string
  accessToken: string
  audio: MetaCallRecordingAudio
  download?: typeof downloadWhatsAppMedia
}): Promise<{ callId: string; settings: CallingSettings } | null> {
  const { db, accountId, metaCallId, accessToken, audio } = args
  if (!audio.id) return null

  const { data: call, error } = await db
    .from('calls')
    .select('*')
    .eq('meta_call_id', metaCallId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[calls webhook] recording lookup failed:', error)
    return null
  }
  if (!call) {
    console.warn('[calls webhook] recording for unknown call:', metaCallId)
    return null
  }
  const row = call as Call
  if (row.recording_key) return null

  const download = args.download ?? downloadWhatsAppMedia
  let downloaded: { buffer: Buffer; contentType: string; mimeType: string }
  try {
    downloaded = await download({ mediaId: audio.id, accessToken })
  } catch (err) {
    console.error(
      '[calls webhook] recording download failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }

  if (!recordingHashesMatch(downloaded.buffer, audio.sha256)) {
    console.error('[calls webhook] recording sha256 mismatch:', metaCallId)
    return null
  }

  const mime =
    recordingContentType(audio.mime_type || downloaded.mimeType || downloaded.contentType)
  const ext = extensionForMime(mime) === 'bin' ? 'ogg' : extensionForMime(mime)
  const path = recordingObjectPath(accountId, row.id, ext)

  const { error: upErr } = await db.storage.from(CALL_RECORDINGS_BUCKET).upload(
    path,
    downloaded.buffer,
    { contentType: mime, upsert: true },
  )
  if (upErr) {
    console.error('[calls webhook] recording store failed:', upErr)
    return null
  }

  const { data: signed } = await db.storage
    .from(CALL_RECORDINGS_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7)

  const threadUrl = await mirrorRecordingToChatMedia(db, {
    accountId,
    callId: row.id,
    buffer: downloaded.buffer,
    mime,
    ext,
  })

  const recordedAt = new Date().toISOString()
  const { data: claimed, error: dbErr } = await db
    .from('calls')
    .update({
      recording_key: path,
      recording_url: signed?.signedUrl ?? threadUrl ?? null,
      recording_bytes: downloaded.buffer.byteLength,
      recorded_at: recordedAt,
      consent_announced: true,
    })
    .eq('id', row.id)
    .is('recording_key', null)
    .select('id')
    .maybeSingle()

  if (dbErr) {
    console.error('[calls webhook] recording metadata update failed:', dbErr)
    return null
  }
  if (!claimed) return null

  const mediaUrl = threadUrl || signed?.signedUrl || null
  if (row.conversation_id && mediaUrl) {
    const { error: msgErr } = await db.from('messages').upsert(
      {
        conversation_id: row.conversation_id,
        sender_type: 'bot',
        content_type: 'audio',
        content_text: 'Call recording',
        media_url: mediaUrl,
        media_type: mime,
        message_id: callRecordingMessageId(metaCallId),
        status: 'delivered',
        created_at: recordedAt,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    if (msgErr && !isUniqueViolation(msgErr)) {
      console.error('[calls webhook] recording message insert failed:', msgErr)
    } else if (!msgErr) {
      await db
        .from('conversations')
        .update({
          last_message_text: 'Call recording',
          last_message_at: recordedAt,
          updated_at: recordedAt,
        })
        .eq('id', row.conversation_id)
    }
  }

  const settings = await ensureCallingSettings(db, accountId)
  return { callId: row.id, settings }
}

async function mirrorRecordingToChatMedia(
  db: SupabaseClient,
  args: {
    accountId: string
    callId: string
    buffer: Buffer
    mime: string
    ext: string
  },
): Promise<string | null> {
  const path = buildMediaPath(
    args.accountId,
    `${args.callId}.${args.ext}`,
    null,
    'call-recordings',
  )
  const { error } = await db.storage.from(MIRROR_BUCKET).upload(path, args.buffer, {
    contentType: args.mime,
    upsert: true,
  })
  if (error) {
    console.warn('[calls webhook] chat-media mirror failed:', error.message)
    return null
  }
  const { data } = db.storage.from(MIRROR_BUCKET).getPublicUrl(path)
  return data.publicUrl || null
}
