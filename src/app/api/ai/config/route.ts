import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { chatKeyForProvider, loadPlatformAiSettings } from '@/lib/ai/platform-settings'
import type { AiProvider } from '@/lib/ai/types'
import { parseVoiceReplyMode } from '@/lib/ai/voice'
import { parseRealtimeVoice } from '@/lib/ai/realtime/voices'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_configs')
      .select(
        'provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_unlimited, auto_reply_max_per_conversation, handoff_agent_id, elevenlabs_voice_id, voice_provider, sarvam_speaker, sarvam_language_code, sarvam_pace, sarvam_temperature, stt_enabled, tts_enabled, voice_reply_mode, typing_indicator_enabled, full_agent_enabled, realtime_voice_enabled, realtime_voice',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }

    const platform = await loadPlatformAiSettings()
    const hasPlatformKey = Boolean(
      platform && chatKeyForProvider(platform, platform.chatProvider),
    )
    if (!data) {
      return NextResponse.json({
        configured: false,
        has_platform_key: hasPlatformKey,
        platform_provider: platform?.chatProvider ?? null,
        platform_model: platform?.chatModel ?? null,
        platform_voice_provider: platform?.voiceProvider ?? null,
      })
    }
    return NextResponse.json({
      configured: true,
      has_key: hasPlatformKey,
      has_platform_key: hasPlatformKey,
      has_embeddings_key: Boolean(platform?.embeddingsApiKey),
      has_elevenlabs_key: Boolean(platform?.elevenlabsApiKey),
      has_sarvam_key: Boolean(platform?.sarvamApiKey),
      platform_provider: platform?.chatProvider ?? null,
      platform_model: platform?.chatModel ?? null,
      platform_voice_provider: platform?.voiceProvider ?? null,
      ...data,
      provider: platform?.chatProvider ?? data.provider,
      model: platform?.chatModel ?? data.model,
      voice_provider: platform?.voiceProvider ?? data.voice_provider,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const platform = await loadPlatformAiSettings()
    const provider: AiProvider = platform?.chatProvider ?? (
      body.provider === 'anthropic' ? 'anthropic' : 'openai'
    )
    const model =
      platform?.chatModel ??
      (typeof body.model === 'string' ? body.model.trim() : '')
    if (!model) return bad('Platform AI model is not configured')

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true

    const autoReplyUnlimited = body.auto_reply_unlimited === true

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    const rejectedKey =
      (typeof body.api_key === 'string' && body.api_key.trim()) ||
      (typeof body.embeddings_api_key === 'string' && body.embeddings_api_key.trim()) ||
      (typeof body.elevenlabs_api_key === 'string' && body.elevenlabs_api_key.trim()) ||
      (typeof body.sarvam_api_key === 'string' && body.sarvam_api_key.trim())
    if (rejectedKey) {
      return bad('API keys are managed by the platform administrator')
    }

    const elevenlabsVoiceId =
      typeof body.elevenlabs_voice_id === 'string'
        ? body.elevenlabs_voice_id.trim() || null
        : undefined
    const sttEnabled =
      'stt_enabled' in body ? body.stt_enabled === true : undefined
    const ttsEnabled =
      'tts_enabled' in body ? body.tts_enabled === true : undefined
    const voiceReplyMode = 'voice_reply_mode' in body
      ? parseVoiceReplyMode(body.voice_reply_mode)
      : undefined
    const typingIndicatorEnabled =
      'typing_indicator_enabled' in body
        ? body.typing_indicator_enabled === true
        : undefined
    const fullAgentEnabled =
      'full_agent_enabled' in body ? body.full_agent_enabled === true : undefined
    const realtimeVoiceEnabled =
      'realtime_voice_enabled' in body
        ? body.realtime_voice_enabled === true && provider === 'openai'
        : undefined
    const realtimeVoice =
      'realtime_voice' in body ? parseRealtimeVoice(body.realtime_voice) : undefined

    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model')
      .eq('account_id', accountId)
      .maybeSingle()

    const shared: Record<string, unknown> = {
      provider,
      model,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_unlimited: autoReplyUnlimited,
      auto_reply_max_per_conversation: maxPer,
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    if (elevenlabsVoiceId !== undefined) {
      shared.elevenlabs_voice_id = elevenlabsVoiceId
    }
    if (sttEnabled !== undefined) shared.stt_enabled = sttEnabled
    if (ttsEnabled !== undefined) shared.tts_enabled = ttsEnabled
    if (voiceReplyMode !== undefined) shared.voice_reply_mode = voiceReplyMode
    if (typingIndicatorEnabled !== undefined) {
      shared.typing_indicator_enabled = typingIndicatorEnabled
    }
    if (fullAgentEnabled !== undefined) {
      shared.full_agent_enabled = fullAgentEnabled
    }
    if (realtimeVoiceEnabled !== undefined) {
      shared.realtime_voice_enabled = realtimeVoiceEnabled
    }
    if (realtimeVoice !== undefined) {
      shared.realtime_voice = realtimeVoice
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_configs')
        .update(shared)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    } else {
      const { error: insErr } = await supabase.from('ai_configs').insert({
        account_id: accountId,
        created_by: userId,
        api_key: null,
        ...shared,
      })
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    }

    // Turning on full-agent mode hands every open thread back to the
    // bot so the inbox toggle and per-conversation pause stay in sync.
    if ('full_agent_enabled' in body && fullAgentEnabled === true) {
      const { error: resumeErr } = await supabase
        .from('conversations')
        .update({
          ai_autoreply_disabled: false,
          assigned_agent_id: null,
          ai_handoff_summary: null,
          ai_reply_count: 0,
        })
        .eq('account_id', accountId)
      if (resumeErr) {
        console.error('[ai/config POST] full-agent resume error:', resumeErr)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete AI configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
