import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  ensureCallingSettings,
  loadCallingSettings,
  parseLiveAiAnswer,
  parseLiveAiVoice,
  parseRecordingAnnouncementLanguage,
} from '@/lib/calling/settings'
import { LIVE_AI_PROMPT_MAX, parseLiveAiPromptField } from '@/lib/calling/live-ai-prompt'
import { loadAiConfig } from '@/lib/ai/config'
import { canLiveAiRealtime, LIVE_AI_NOT_READY_MESSAGE, usesLiveTtsVoice } from '@/lib/calling/live-ai-ready'
import {
  CallActionError,
  setCallingEnabled,
  syncMetaCallAppearance,
} from '@/lib/whatsapp/call-actions'
import type { CallHours, CallingSettings, LiveAiVoice } from '@/types'

async function extras(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  voice?: LiveAiVoice,
) {
  let liveAiReady = false
  let liveAiTtsAvailable = false
  let liveAiTtsVoice = false
  try {
    const config = await loadAiConfig(supabase, accountId)
    liveAiReady = canLiveAiRealtime(config)
    liveAiTtsAvailable = usesLiveTtsVoice(config)
    liveAiTtsVoice = usesLiveTtsVoice(config, voice)
  } catch {
    liveAiReady = false
    liveAiTtsAvailable = false
    liveAiTtsVoice = false
  }

  const { data: shop } = await supabase
    .from('shopify_configs')
    .select('is_active')
    .eq('account_id', accountId)
    .maybeSingle()

  return {
    live_ai_ready: liveAiReady,
    live_ai_tts_available: liveAiTtsAvailable,
    live_ai_tts_voice: liveAiTtsVoice,
    shopify_connected: Boolean(shop?.is_active),
  }
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const settings = await loadCallingSettings(supabase, accountId)
    const { data: wa } = await supabase
      .from('whatsapp_config')
      .select('calling_status, last_calling_error, status')
      .eq('account_id', accountId)
      .maybeSingle()
    const extra = await extras(supabase, accountId, settings.live_ai_voice)

    return NextResponse.json({
      settings,
      calling_status: wa?.calling_status === 'enabled' ? 'enabled' : 'disabled',
      last_calling_error: wa?.last_calling_error ?? null,
      whatsapp_connected: wa?.status === 'connected',
      ...extra,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const keys = Object.keys(body)
    const voiceOnly = keys.length === 1 && keys[0] === 'live_ai_voice'
    const { supabase, accountId } = voiceOnly
      ? await requireRole('agent')
      : await requireRole('admin')
    const current = await ensureCallingSettings(supabase, accountId)

    const patch: Partial<CallingSettings> = {}
    if (typeof body.recording_enabled === 'boolean') patch.recording_enabled = body.recording_enabled
    if (typeof body.announce_recording === 'boolean') patch.announce_recording = body.announce_recording
    if (typeof body.recording_purpose === 'string') {
      const purpose = body.recording_purpose.trim()
      if (purpose.length < 1 || purpose.length > 250) {
        return NextResponse.json(
          { error: 'recording_purpose must be 1–250 characters' },
          { status: 400 },
        )
      }
      patch.recording_purpose = purpose
    }
    if (typeof body.recording_announcement_language === 'string') {
      const lang = parseRecordingAnnouncementLanguage(body.recording_announcement_language)
      if (body.recording_announcement_language !== lang) {
        return NextResponse.json(
          { error: 'recording_announcement_language is not a supported locale' },
          { status: 400 },
        )
      }
      patch.recording_announcement_language = lang
    }
    if (typeof body.transcribe_enabled === 'boolean') patch.transcribe_enabled = body.transcribe_enabled
    if (typeof body.ai_enabled === 'boolean') patch.ai_enabled = body.ai_enabled
    if (typeof body.ai_auto_send_followup === 'boolean') {
      patch.ai_auto_send_followup = body.ai_auto_send_followup
    }
    if (typeof body.retention_days === 'number') {
      const days = Math.floor(body.retention_days)
      if (days < 1 || days > 365) {
        return NextResponse.json({ error: 'retention_days must be 1–365' }, { status: 400 })
      }
      patch.retention_days = days
    }
    if (typeof body.ring_timeout_seconds === 'number') {
      const sec = Math.floor(body.ring_timeout_seconds)
      if (sec < 15 || sec > 120) {
        return NextResponse.json({ error: 'ring_timeout_seconds must be 15–120' }, { status: 400 })
      }
      patch.ring_timeout_seconds = sec
    }
    if (body.call_icon_visibility === 'DEFAULT' || body.call_icon_visibility === 'DISABLE_ALL') {
      patch.call_icon_visibility = body.call_icon_visibility
    }
    if (body.call_hours === null || (body.call_hours && typeof body.call_hours === 'object')) {
      patch.call_hours = (body.call_hours as CallHours | null) ?? null
    }
    if (typeof body.live_ai_answer === 'string') {
      const next = parseLiveAiAnswer(body.live_ai_answer)
      if (body.live_ai_answer !== 'off' && next === 'off') {
        return NextResponse.json(
          { error: 'live_ai_answer must be off, ai_first, or after_timeout' },
          { status: 400 },
        )
      }
      if (next !== 'off') {
        let config
        try {
          config = await loadAiConfig(supabase, accountId)
        } catch {
          config = null
        }
        if (!canLiveAiRealtime(config)) {
          return NextResponse.json(
            {
              error: LIVE_AI_NOT_READY_MESSAGE,
              code: 'live_ai_not_ready',
            },
            { status: 400 },
          )
        }
      }
      patch.live_ai_answer = next
    }
    if (typeof body.live_ai_voice === 'string') {
      const next = parseLiveAiVoice(body.live_ai_voice)
      if (body.live_ai_voice !== next) {
        return NextResponse.json(
          { error: 'live_ai_voice must be elevenlabs or openai' },
          { status: 400 },
        )
      }
      if (next === 'elevenlabs') {
        let config
        try {
          config = await loadAiConfig(supabase, accountId)
        } catch {
          config = null
        }
        if (!usesLiveTtsVoice(config)) {
          return NextResponse.json(
            {
              error: 'Add a Voice Agent key to use ElevenLabs v3 on live calls.',
              code: 'tts_not_ready',
            },
            { status: 400 },
          )
        }
      }
      patch.live_ai_voice = next
    }
    for (const key of [
      'live_ai_behaviour',
      'live_ai_business_context',
      'live_ai_instructions',
    ] as const) {
      if (!(key in body)) continue
      const parsed = parseLiveAiPromptField(body[key])
      if (!parsed.ok) {
        return NextResponse.json(
          {
            error: `${key} must be a string of at most ${LIVE_AI_PROMPT_MAX} characters, or null`,
          },
          { status: 400 },
        )
      }
      patch[key] = parsed.value
    }

    let callingStatus: 'enabled' | 'disabled' | undefined
    if (typeof body.enabled === 'boolean') {
      const result = await setCallingEnabled({
        accountId,
        enabled: body.enabled,
        call_icon_visibility: patch.call_icon_visibility ?? current.call_icon_visibility,
      })
      callingStatus = result.calling_status
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase
        .from('calling_settings')
        .update(patch)
        .eq('account_id', accountId)
      if (error) {
        return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
      }
    }

    const enabledNow =
      callingStatus === 'enabled' ||
      (callingStatus == null &&
        (await supabase
          .from('whatsapp_config')
          .select('calling_status')
          .eq('account_id', accountId)
          .maybeSingle()).data?.calling_status === 'enabled')

    const icon = patch.call_icon_visibility ?? current.call_icon_visibility
    const hours = patch.call_hours !== undefined ? patch.call_hours : current.call_hours
    const appearanceChanged =
      patch.call_icon_visibility !== undefined || patch.call_hours !== undefined
    if (appearanceChanged) {
      await syncMetaCallAppearance({
        accountId,
        enabled: Boolean(enabledNow),
        call_icon_visibility: icon,
        call_hours: hours,
      })
    }

    const settings = await ensureCallingSettings(supabase, accountId)
    const { data: wa } = await supabase
      .from('whatsapp_config')
      .select('calling_status, last_calling_error, status')
      .eq('account_id', accountId)
      .maybeSingle()
    const extra = await extras(supabase, accountId, settings.live_ai_voice)

    return NextResponse.json({
      settings,
      calling_status: wa?.calling_status === 'enabled' ? 'enabled' : 'disabled',
      last_calling_error: wa?.last_calling_error ?? null,
      whatsapp_connected: wa?.status === 'connected',
      ...extra,
    })
  } catch (err) {
    if (err instanceof CallActionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
