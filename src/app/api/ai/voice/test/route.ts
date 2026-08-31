import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { validateElevenLabsKey } from '@/lib/elevenlabs'
import { textToSpeech as elevenLabsTts, ELEVENLABS_TTS_MIME } from '@/lib/elevenlabs/tts'
import { validateSarvamKey, textToSpeech as sarvamTts } from '@/lib/sarvam'
import { SARVAM_TTS_MIME_MP3 } from '@/lib/sarvam/limits'
import { AiError } from '@/lib/ai/types'
import {
  effectiveVoiceId,
  parseSarvamLanguage,
  parseSarvamSpeaker,
  parseVoiceProvider,
} from '@/lib/ai/voice'

const PREVIEW_TEXT = 'Hello, this is a voice preview from your assistant.'

/**
 * POST /api/ai/voice/test  (admin+)
 *
 * Validate a speech-provider key (and optionally synthesise a short
 * preview) WITHOUT saving. Keys never leave the server — the preview
 * is returned as base64 audio.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const userLimit = checkRateLimit(`ai-voice-test:${userId}`, RATE_LIMITS.adminAction)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(
      `ai-voice-test-acct:${accountId}`,
      RATE_LIMITS.aiVoiceAccount,
    )
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const provider = parseVoiceProvider(body.voice_provider)
    const preview = body.preview === true

    if (provider === 'sarvam') {
      const rawKey =
        typeof body.sarvam_api_key === 'string' ? body.sarvam_api_key.trim() : ''
      let apiKey = rawKey
      if (!apiKey) {
        const { data: existing } = await supabase
          .from('ai_configs')
          .select('sarvam_api_key')
          .eq('account_id', accountId)
          .maybeSingle()
        if (!existing?.sarvam_api_key) {
          return NextResponse.json(
            { error: 'Enter a Sarvam API key to test.' },
            { status: 400 },
          )
        }
        try {
          apiKey = decrypt(existing.sarvam_api_key)
        } catch {
          return NextResponse.json(
            {
              error:
                'Stored Sarvam key could not be decrypted — re-enter your key.',
            },
            { status: 400 },
          )
        }
      }

      const speaker = parseSarvamSpeaker(body.sarvam_speaker)
      const languageCode = parseSarvamLanguage(body.sarvam_language_code)

      try {
        if (!preview) {
          await validateSarvamKey(apiKey)
          return NextResponse.json({ ok: true })
        }
        const spoken = await sarvamTts({
          apiKey,
          speaker,
          languageCode,
          text: PREVIEW_TEXT,
          outputAudioCodec: 'mp3',
        })
        return NextResponse.json({
          ok: true,
          audio_base64: Buffer.from(spoken.bytes).toString('base64'),
          audio_mime_type: spoken.mimeType || SARVAM_TTS_MIME_MP3,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/voice/test] sarvam error:', err)
        return NextResponse.json(
          { error: 'Could not validate the Sarvam key.' },
          { status: 400 },
        )
      }
    }

    const rawKey =
      typeof body.elevenlabs_api_key === 'string'
        ? body.elevenlabs_api_key.trim()
        : ''
    let apiKey = rawKey
    if (!apiKey) {
      const { data: existing } = await supabase
        .from('ai_configs')
        .select('elevenlabs_api_key')
        .eq('account_id', accountId)
        .maybeSingle()
      if (!existing?.elevenlabs_api_key) {
        return NextResponse.json(
          { error: 'Enter an ElevenLabs API key to test.' },
          { status: 400 },
        )
      }
      try {
        apiKey = decrypt(existing.elevenlabs_api_key)
      } catch {
        return NextResponse.json(
          {
            error:
              'Stored ElevenLabs key could not be decrypted — re-enter your key.',
          },
          { status: 400 },
        )
      }
    }

    const voiceId = effectiveVoiceId(
      typeof body.elevenlabs_voice_id === 'string'
        ? body.elevenlabs_voice_id
        : null,
    )

    try {
      await validateElevenLabsKey(apiKey)
      if (!preview) return NextResponse.json({ ok: true })

      const spoken = await elevenLabsTts({
        apiKey,
        voiceId,
        text: PREVIEW_TEXT,
      })
      return NextResponse.json({
        ok: true,
        audio_base64: Buffer.from(spoken.bytes).toString('base64'),
        audio_mime_type: spoken.mimeType || ELEVENLABS_TTS_MIME,
      })
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: 400 },
        )
      }
      console.error('[ai/voice/test] error:', err)
      return NextResponse.json(
        { error: 'Could not validate the ElevenLabs key.' },
        { status: 400 },
      )
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
