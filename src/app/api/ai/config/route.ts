import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { validateElevenLabsKey } from '@/lib/elevenlabs'
import { AiError, AI_VOICE_DEFAULTS, type AiProvider } from '@/lib/ai/types'
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
      // `api_key` is selected only to derive `has_key` — it is stripped
      // out below and never returned to the client.
      .select(
        'provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_unlimited, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key, elevenlabs_api_key, elevenlabs_voice_id, voice_provider, sarvam_api_key, sarvam_speaker, sarvam_language_code, sarvam_pace, sarvam_temperature, stt_enabled, tts_enabled, voice_reply_mode, typing_indicator_enabled, full_agent_enabled, realtime_voice_enabled, realtime_voice',
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

    if (!data) return NextResponse.json({ configured: false })
    // The keys are selected only to derive the has_* flags; none of
    // them are returned to the client.
    const { api_key, embeddings_api_key, elevenlabs_api_key, sarvam_api_key, ...safe } = data
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      has_elevenlabs_key: !!elevenlabs_api_key,
      has_sarvam_key: !!sarvam_api_key,
      ...safe,
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

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic') {
      return bad('provider must be "openai" or "anthropic"')
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

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

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    const rawElevenlabsKey =
      typeof body.elevenlabs_api_key === 'string'
        ? body.elevenlabs_api_key.trim()
        : ''
    const clearElevenlabsKey = body.elevenlabs_api_key === null
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

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, api_key')
      .eq('account_id', accountId)
      .maybeSingle()

    let apiKeyPlain: string
    if (rawKey) {
      apiKeyPlain = rawKey
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad('Stored API key could not be decrypted — re-enter your key.')
      }
    } else {
      return bad('api_key is required')
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyUnlimited,
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          embeddingsApiKey: null,
          ...AI_VOICE_DEFAULTS,
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping'])
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Embeddings key: ${err.message}`, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
    }

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
        console.error('[ai/config POST] ElevenLabs validation error:', err)
        return bad('Could not validate the ElevenLabs key.')
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null
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
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null
    }
    if (rawElevenlabsKey) {
      shared.elevenlabs_api_key = encrypt(rawElevenlabsKey)
    } else if (clearElevenlabsKey) {
      shared.elevenlabs_api_key = null
    }
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
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
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
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
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
