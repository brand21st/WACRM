import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'
import { validateElevenLabsKey } from '@/lib/elevenlabs'
import { validateSarvamKey } from '@/lib/sarvam'
import { AiError } from '@/lib/ai/types'
import {
  parseSarvamLanguage,
  parseSarvamPace,
  parseSarvamSpeaker,
  parseSarvamTemperature,
  parseVoiceProvider,
  parseVoiceReplyMode,
} from '@/lib/ai/voice'
import { parseRealtimeVoice } from '@/lib/ai/realtime/voices'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * POST /api/ai/voice/config  (admin+)
 *
 * Partial update of speech-layer columns on the existing `ai_configs`
 * row. Does not require the chat provider/model/key. Fails if Chat
 * Agent Setup has never been saved.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-voice-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!existing) {
      return NextResponse.json(
        {
          error:
            'Set up the Chat Agent first — voice settings are saved on that configuration.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const voiceProvider = parseVoiceProvider(body.voice_provider)
    const patch: Record<string, unknown> = {
      voice_provider: voiceProvider,
    }

    const rawElevenlabsKey =
      typeof body.elevenlabs_api_key === 'string'
        ? body.elevenlabs_api_key.trim()
        : ''
    const clearElevenlabsKey = body.elevenlabs_api_key === null
    if (rawElevenlabsKey) {
      try {
        await validateElevenLabsKey(rawElevenlabsKey)
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `ElevenLabs key: ${err.message}`, code: err.code },
            { status: 400 },
          )
        }
        return bad('Could not validate the ElevenLabs key.')
      }
      patch.elevenlabs_api_key = encrypt(rawElevenlabsKey)
    } else if (clearElevenlabsKey) {
      patch.elevenlabs_api_key = null
    }
    if ('elevenlabs_voice_id' in body) {
      patch.elevenlabs_voice_id =
        typeof body.elevenlabs_voice_id === 'string'
          ? body.elevenlabs_voice_id.trim() || null
          : null
    }

    const rawSarvamKey =
      typeof body.sarvam_api_key === 'string' ? body.sarvam_api_key.trim() : ''
    const clearSarvamKey = body.sarvam_api_key === null
    if (rawSarvamKey) {
      try {
        await validateSarvamKey(rawSarvamKey)
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Sarvam key: ${err.message}`, code: err.code },
            { status: 400 },
          )
        }
        return bad('Could not validate the Sarvam key.')
      }
      patch.sarvam_api_key = encrypt(rawSarvamKey)
    } else if (clearSarvamKey) {
      patch.sarvam_api_key = null
    }
    if ('sarvam_speaker' in body) {
      patch.sarvam_speaker = parseSarvamSpeaker(body.sarvam_speaker)
    }
    if ('sarvam_language_code' in body) {
      patch.sarvam_language_code = parseSarvamLanguage(body.sarvam_language_code)
    }
    if ('sarvam_pace' in body) {
      patch.sarvam_pace = parseSarvamPace(body.sarvam_pace)
    }
    if ('sarvam_temperature' in body) {
      patch.sarvam_temperature = parseSarvamTemperature(body.sarvam_temperature)
    }

    if ('stt_enabled' in body) patch.stt_enabled = body.stt_enabled === true
    if ('tts_enabled' in body) patch.tts_enabled = body.tts_enabled === true
    if ('voice_reply_mode' in body) {
      patch.voice_reply_mode = parseVoiceReplyMode(body.voice_reply_mode)
    }

    const realtimeVoiceEnabled =
      'realtime_voice_enabled' in body
        ? body.realtime_voice_enabled === true &&
          existing.provider === 'openai' &&
          voiceProvider === 'elevenlabs'
        : undefined
    if (realtimeVoiceEnabled !== undefined) {
      patch.realtime_voice_enabled = realtimeVoiceEnabled
    }
    if ('realtime_voice' in body) {
      patch.realtime_voice = parseRealtimeVoice(body.realtime_voice)
    }

    const { error } = await supabase
      .from('ai_configs')
      .update(patch)
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/voice/config POST] update error:', error)
      return NextResponse.json(
        { error: 'Failed to save voice configuration' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
