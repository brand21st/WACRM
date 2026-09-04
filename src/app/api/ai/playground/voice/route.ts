import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { AiError, type ChatMessage } from '@/lib/ai/types'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { shopifyLlmTools, executeShopifyTool } from '@/lib/shopify/tools'
import type { ShopifyProductCard } from '@/lib/shopify'
import { canTranscribe, canSpeak, transcribeSpeech, synthesizeSpeech } from '@/lib/ai/speech'
import {
  isAllowedSttMime,
  normalizeAudioMime,
  STT_MAX_BYTES,
} from '@/lib/elevenlabs/limits'

export const maxDuration = 60

const MAX_TURNS = 20

/**
 * POST /api/ai/playground/voice  (agent+)
 *
 * Push-to-talk path for the Playground. Accepts multipart audio plus
 * the running transcript, transcribes with the configured speech
 * provider (ElevenLabs or Sarvam), runs the same knowledge-base /
 * OpenAI (or Anthropic) / handoff pipeline as the text playground, then
 * optionally synthesises the reply. The text playground route is left
 * unchanged.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const userLimit = checkRateLimit(`ai-playground-voice:${userId}`, RATE_LIMITS.aiVoice)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(
      `ai-playground-voice-acct:${accountId}`,
      RATE_LIMITS.aiVoiceAccount,
    )
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 })
    }

    const audioField = form.get('audio')
    if (!(audioField instanceof Blob) || audioField.size === 0) {
      return NextResponse.json({ error: 'audio is required.' }, { status: 400 })
    }
    if (audioField.size > STT_MAX_BYTES) {
      return NextResponse.json(
        { error: 'Audio is too large.' },
        { status: 400 },
      )
    }

    const mime = normalizeAudioMime(audioField.type) ?? 'audio/webm'
    if (!isAllowedSttMime(mime)) {
      return NextResponse.json(
        { error: `Unsupported audio type: ${mime}` },
        { status: 400 },
      )
    }

    const prior = parsePriorMessages(form.get('messages'))

    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
    }).catch((err) => {
      console.error('[ai/playground/voice] loadAiConfig error:', err)
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      })
    })
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }
    if (!canTranscribe(config)) {
      return NextResponse.json(
        {
          error:
            'Voice is not configured. Add a speech key on Voice Agent → Build.',
          code: 'voice_not_configured',
        },
        { status: 400 },
      )
    }

    const bytes = new Uint8Array(await audioField.arrayBuffer())
    const fileName =
      audioField instanceof File && audioField.name
        ? audioField.name
        : undefined
    const transcript = await transcribeSpeech({
      config,
      audio: bytes,
      mimeType: mime,
      fileName,
    })
    if (!transcript) {
      return NextResponse.json(
        { error: 'Could not hear anything in that recording.', code: 'empty_transcript' },
        { status: 400 },
      )
    }

    const messages: ChatMessage[] = [
      ...prior,
      { role: 'user' as const, content: transcript },
    ].slice(-MAX_TURNS)

    const knowledge = await retrieveKnowledge(
      supabase,
      accountId,
      config,
      latestUserMessage(messages),
    )
    const shopify = await loadShopifyConfig(supabase, accountId).catch(() => null)
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      shopify: Boolean(shopify),
      whatsappCatalog: Boolean(shopify?.metaCatalogId?.trim()),
    })

    const productCards: ShopifyProductCard[] = []
    const { text, handoff } = await generateReply({
      config,
      systemPrompt,
      messages,
      ...(shopify
        ? {
            tools: shopifyLlmTools({
              whatsappCatalog: Boolean(shopify.metaCatalogId?.trim()),
            }),
            executeTool: async (name, args) => {
              const result = await executeShopifyTool(
                {
                  db: supabase,
                  config: shopify,
                  contactPhone: null,
                  productCards,
                },
                name,
                args,
              )
              productCards.push(...result.cards)
              return result.json
            },
          }
        : {}),
    })

    let audioBase64: string | null = null
    let audioMimeType: string | null = null
    if (canSpeak(config) && text && !handoff) {
      try {
        const spoken = await synthesizeSpeech({ config, text })
        audioBase64 = Buffer.from(spoken.bytes).toString('base64')
        audioMimeType = spoken.mimeType || 'audio/mpeg'
      } catch (err) {
        // Generation succeeded — surface the text even if TTS fails.
        console.error('[ai/playground/voice] TTS failed:', err)
      }
    }

    return NextResponse.json({
      transcript,
      reply: text,
      handoff,
      audio_base64: audioBase64,
      audio_mime_type: audioMimeType,
    })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}

function parsePriorMessages(raw: FormDataEntryValue | null): ChatMessage[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)
  } catch {
    return []
  }
}
