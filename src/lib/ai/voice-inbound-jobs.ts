import type { SupabaseClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { mapPool } from '@/lib/concurrency'
import { decrypt } from '@/lib/whatsapp/encryption'
import { transcribeInboundVoiceNote } from '@/lib/ai/transcribe-inbound'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'

export const VOICE_JOB_STALE_MS = 5 * 60_000
export const VOICE_JOB_MAX_ATTEMPTS = 5
export const VOICE_DRAIN_CONCURRENCY = 4

export interface EnqueueVoiceInboundJobArgs {
  db: SupabaseClient
  accountId: string
  conversationId: string
  contactId: string
  messageId: string
  userId: string
  metaMessageId: string
  mediaId: string
  mimeType?: string | null
}

export interface VoiceInboundJobRow {
  id: string
  account_id: string
  conversation_id: string
  contact_id: string
  message_id: string
  user_id: string
  meta_message_id: string
  media_id: string
  mime_type: string | null
  attempts: number
}

/**
 * Insert a pending voice job. Idempotent on message_id so a Meta
 * webhook replay does not double-queue. Returns false when the insert
 * failed for a reason other than "already queued".
 */
export async function enqueueVoiceInboundJob(
  args: EnqueueVoiceInboundJobArgs,
): Promise<boolean> {
  const { error } = await args.db.from('voice_inbound_jobs').insert({
    account_id: args.accountId,
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    message_id: args.messageId,
    user_id: args.userId,
    meta_message_id: args.metaMessageId,
    media_id: args.mediaId,
    mime_type: args.mimeType ?? null,
    status: 'pending',
    run_at: new Date().toISOString(),
  })
  if (!error) return true
  if (isUniqueViolation(error)) return true
  console.error('[voice-jobs] enqueue failed:', error.message)
  return false
}

/**
 * Claim due (or abandoned running) jobs and run STT + spoken reply.
 * One cron tick processes up to `limit` jobs, with a small in-process
 * concurrency cap so Meta's media CDN is not stampeded.
 */
export async function drainVoiceInboundJobs(
  db: SupabaseClient,
  limit = 20,
): Promise<{ processed: number; failed: number }> {
  await reclaimStaleVoiceJobs(db)

  const { data: due, error } = await db
    .from('voice_inbound_jobs')
    .select(
      'id, account_id, conversation_id, contact_id, message_id, user_id, meta_message_id, media_id, mime_type, attempts',
    )
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  if (!due?.length) return { processed: 0, failed: 0 }

  let processed = 0
  let failed = 0

  await mapPool(due as VoiceInboundJobRow[], VOICE_DRAIN_CONCURRENCY, async (row) => {
    const claimedAttempts = row.attempts + 1
    const { data: claim } = await db
      .from('voice_inbound_jobs')
      .update({
        status: 'running',
        attempts: claimedAttempts,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) return

    const ok = await runVoiceInboundJob(db, {
      ...row,
      attempts: claimedAttempts,
    })
    if (ok) processed += 1
    else failed += 1
  })

  return { processed, failed }
}

export async function reclaimStaleVoiceJobs(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - VOICE_JOB_STALE_MS).toISOString()
  const { error } = await db
    .from('voice_inbound_jobs')
    .update({
      status: 'pending',
      error: 'reclaimed stale running job',
      updated_at: now.toISOString(),
    })
    .eq('status', 'running')
    .lt('updated_at', cutoff)
  if (error) {
    console.error('[voice-jobs] stale reclaim failed:', error.message)
  }
}

async function runVoiceInboundJob(
  db: SupabaseClient,
  row: VoiceInboundJobRow,
): Promise<boolean> {
  try {
    const accessToken = await loadAccountAccessToken(db, row.account_id)
    if (!accessToken) {
      await failOrRetry(db, row, 'whatsapp access token unavailable')
      return false
    }

    const { data: message, error: msgErr } = await db
      .from('messages')
      .select('id, content_text')
      .eq('id', row.message_id)
      .maybeSingle()
    if (msgErr || !message) {
      await failOrRetry(db, row, msgErr?.message || 'message row missing')
      return false
    }

    let transcript =
      typeof message.content_text === 'string' ? message.content_text.trim() : ''
    if (!transcript) {
      const text = await transcribeInboundVoiceNote({
        accountId: row.account_id,
        mediaId: row.media_id,
        accessToken,
        mimeType: row.mime_type,
        contentText: null,
        contentType: 'audio',
        throwOnMediaError: true,
      })
      transcript = text?.trim() || ''
      if (transcript) {
        const { error: trErr } = await db
          .from('messages')
          .update({ content_text: transcript })
          .eq('id', row.message_id)
        if (trErr) {
          console.error('[voice-jobs] persist transcript failed:', trErr.message)
        } else {
          await db
            .from('conversations')
            .update({ last_message_text: transcript })
            .eq('id', row.conversation_id)
        }
      }
    }

    if (!transcript) {
      await failOrRetry(db, row, 'transcription empty')
      return false
    }

    await dispatchInboundToAiReply({
      accountId: row.account_id,
      conversationId: row.conversation_id,
      contactId: row.contact_id,
      configOwnerUserId: row.user_id,
      inboundContentType: 'audio',
      inboundMetaMessageId: row.meta_message_id,
    }).catch((err) => {
      console.error(
        '[voice-jobs] auto-reply failed:',
        err instanceof Error ? err.message : err,
      )
    })

    await db
      .from('voice_inbound_jobs')
      .update({
        status: 'completed',
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[voice-jobs] job failed:', message)
    await failOrRetry(db, row, message)
    return false
  }
}

async function failOrRetry(
  db: SupabaseClient,
  row: VoiceInboundJobRow,
  error: string,
): Promise<void> {
  // `row.attempts` was incremented when the job was claimed.
  if (row.attempts >= VOICE_JOB_MAX_ATTEMPTS) {
    await db
      .from('voice_inbound_jobs')
      .update({
        status: 'failed',
        attempts: row.attempts,
        error,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    return
  }
  const delayMs = 15_000 * 2 ** Math.min(Math.max(row.attempts - 1, 0), 4)
  await db
    .from('voice_inbound_jobs')
    .update({
      status: 'pending',
      attempts: row.attempts,
      error,
      run_at: new Date(Date.now() + delayMs).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
}

async function loadAccountAccessToken(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('access_token')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle()
  if (error || !data?.access_token) return null
  try {
    return decrypt(data.access_token as string)
  } catch (err) {
    console.error(
      '[voice-jobs] access_token decrypt failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
