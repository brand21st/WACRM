import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { needsTranscription } from './voice'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { canTranscribe, transcribeSpeech } from './speech'

export interface TranscribeInboundVoiceArgs {
  accountId: string
  mediaId: string
  accessToken: string
  mimeType?: string | null
  /** Skip STT when this inbound already has text (replay / caption). */
  contentText?: string | null
  contentType: string
  /** Bytes already fetched for the inbox mirror — skip a second Meta download. */
  audio?: Buffer | Uint8Array | null
}

/**
 * Best-effort STT for one inbound WhatsApp voice note. NEVER throws —
 * the webhook must still 200 to Meta and keep the audio row even if
 * ElevenLabs is down, unconfigured, or rate-limited.
 *
 * Returns the transcript, or null when transcription was skipped or
 * failed. Callers persist it on `messages.content_text`.
 */
export async function transcribeInboundVoiceNote(
  args: TranscribeInboundVoiceArgs,
): Promise<string | null> {
  if (!needsTranscription(args.contentType, args.contentText)) return null

  try {
    const db = supabaseAdmin()
    const config = await loadAiConfig(db, args.accountId, {
      requireActive: false,
    })
    if (!config || !canTranscribe(config)) return null

    const limit = checkRateLimit(
      `ai-stt:${args.accountId}`,
      RATE_LIMITS.aiSttAccount,
    )
    if (!limit.success) {
      console.warn(
        `[ai voice] account ${args.accountId} is above the STT budget — still transcribing so overlapping voice notes are not dropped.`,
      )
    }

    let buffer: Buffer
    let mime = args.mimeType || ''
    if (args.audio && args.audio.byteLength > 0) {
      buffer = Buffer.from(args.audio)
    } else {
      const info = await getMediaUrl({
        mediaId: args.mediaId,
        accessToken: args.accessToken,
      })
      const downloaded = await downloadMedia({
        downloadUrl: info.url,
        accessToken: args.accessToken,
      })
      buffer = downloaded.buffer
      mime = mime || info.mimeType || downloaded.contentType
    }

    const text = await transcribeSpeech({
      config,
      audio: buffer,
      mimeType: mime,
    })
    return text || null
  } catch (err) {
    console.error('[ai voice] inbound STT failed:', err)
    return null
  }
}
