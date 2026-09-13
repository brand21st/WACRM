import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { __resetPlatformAiSettingsCache } from '@/lib/ai/platform-settings'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { validateElevenLabsKey } from '@/lib/elevenlabs'
import { validateSarvamKey } from '@/lib/sarvam'
import { AiError, AI_VOICE_DEFAULTS, type AiProvider } from '@/lib/ai/types'
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults'
import { encrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  try {
    const { admin } = await requirePlatformAdmin()
    const { data, error } = await admin
      .from('platform_ai_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Failed to load AI settings' }, { status: 500 })
    return NextResponse.json({
      chat_provider: data?.chat_provider ?? 'openai',
      chat_model: data?.chat_model ?? '',
      voice_provider: data?.voice_provider ?? 'elevenlabs',
      global_ai_enabled: data?.global_ai_enabled !== false,
      has_openai_key: Boolean(data?.openai_api_key),
      has_anthropic_key: Boolean(data?.anthropic_api_key),
      has_openrouter_key: Boolean(data?.openrouter_api_key),
      has_embeddings_key: Boolean(data?.embeddings_api_key),
      has_elevenlabs_key: Boolean(data?.elevenlabs_api_key),
      has_sarvam_key: Boolean(data?.sarvam_api_key),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:ai:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return bad('Invalid body')

    const chatProvider: AiProvider =
      body.chat_provider === 'anthropic'
        ? 'anthropic'
        : body.chat_provider === 'openrouter'
          ? 'openrouter'
          : 'openai'
    const chatModel =
      typeof body.chat_model === 'string' ? body.chat_model.trim() : ''
    if (!chatModel) return bad('chat_model is required')
    const voiceProvider = body.voice_provider === 'sarvam' ? 'sarvam' : 'elevenlabs'
    const globalAiEnabled = body.global_ai_enabled !== false

    const patch: Record<string, unknown> = {
      chat_provider: chatProvider,
      chat_model: chatModel,
      voice_provider: voiceProvider,
      global_ai_enabled: globalAiEnabled,
    }

    async function setKey(
      field: string,
      incoming: unknown,
      validate: ((plain: string) => Promise<void>) | null,
    ) {
      if (incoming === null) {
        patch[field] = null
        return
      }
      if (typeof incoming !== 'string' || !incoming.trim()) return
      const plain = incoming.trim()
      if (validate) await validate(plain)
      patch[field] = encrypt(plain)
    }

    try {
      await setKey('openai_api_key', body.openai_api_key, async (plain) => {
        await validateAiCredentials({
          provider: 'openai',
          model: chatModel || AI_PROVIDER_DEFAULT_MODEL.openai,
          apiKey: plain,
          systemPrompt: null,
          isActive: true,
          autoReplyEnabled: false,
          autoReplyUnlimited: false,
          autoReplyMaxPerConversation: 3,
          handoffAgentId: null,
          embeddingsApiKey: null,
          ...AI_VOICE_DEFAULTS,
        })
      })
      await setKey('anthropic_api_key', body.anthropic_api_key, async (plain) => {
        await validateAiCredentials({
          provider: 'anthropic',
          model:
            chatProvider === 'anthropic'
              ? chatModel
              : AI_PROVIDER_DEFAULT_MODEL.anthropic,
          apiKey: plain,
          systemPrompt: null,
          isActive: true,
          autoReplyEnabled: false,
          autoReplyUnlimited: false,
          autoReplyMaxPerConversation: 3,
          handoffAgentId: null,
          embeddingsApiKey: null,
          ...AI_VOICE_DEFAULTS,
        })
      })
      await setKey('openrouter_api_key', body.openrouter_api_key, async (plain) => {
        await validateAiCredentials({
          provider: 'openrouter',
          model:
            chatProvider === 'openrouter'
              ? chatModel || AI_PROVIDER_DEFAULT_MODEL.openrouter
              : AI_PROVIDER_DEFAULT_MODEL.openrouter,
          apiKey: plain,
          systemPrompt: null,
          isActive: true,
          autoReplyEnabled: false,
          autoReplyUnlimited: false,
          autoReplyMaxPerConversation: 3,
          handoffAgentId: null,
          embeddingsApiKey: null,
          ...AI_VOICE_DEFAULTS,
        })
      })
      await setKey('embeddings_api_key', body.embeddings_api_key, async (plain) => {
        await embedTexts(plain, ['ping'])
      })
      await setKey('elevenlabs_api_key', body.elevenlabs_api_key, validateElevenLabsKey)
      await setKey('sarvam_api_key', body.sarvam_api_key, validateSarvamKey)
    } catch (err) {
      if (err instanceof AiError) {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 400 })
      }
      throw err
    }

    const { error } = await admin
      .from('platform_ai_settings')
      .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    if (error) {
      console.error('[super-admin/ai PUT]', error)
      if (error.code === '42703' || error.message?.includes('openrouter_api_key')) {
        return NextResponse.json(
          { error: 'Database column missing: Please run migration 101_openrouter.sql in your Supabase SQL Editor.' },
          { status: 400 },
        )
      }
      if (error.code === '23514' && error.message?.includes('chat_provider')) {
        return NextResponse.json(
          { error: 'Database constraint missing: Please run migration 101_openrouter.sql to allow openrouter as chat provider.' },
          { status: 400 },
        )
      }
      return NextResponse.json({ error: 'Failed to save AI settings' }, { status: 500 })
    }
    __resetPlatformAiSettingsCache()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
