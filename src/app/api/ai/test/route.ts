import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  loadPlatformAiSettings,
  requirePlatformChatKey,
} from '@/lib/ai/platform-settings'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, AI_VOICE_DEFAULTS } from '@/lib/ai/types'

/**
 * POST /api/ai/test  (admin+)
 *
 * Re-test the hosted platform chat key. Merchants cannot supply a key.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (body && typeof body === 'object') {
      const pasted =
        (typeof body.api_key === 'string' && body.api_key.trim()) ||
        (typeof body.openai_api_key === 'string' && body.openai_api_key.trim()) ||
        (typeof body.anthropic_api_key === 'string' && body.anthropic_api_key.trim())
      if (pasted) {
        return NextResponse.json(
          { error: 'API keys are managed by the platform administrator' },
          { status: 400 },
        )
      }
    }

    const platform = await loadPlatformAiSettings()
    const key = await requirePlatformChatKey(platform?.chatProvider)
    if (!key.ok) {
      return NextResponse.json({ error: key.error, code: key.code }, { status: 400 })
    }
    if (!platform) {
      return NextResponse.json({ error: 'Platform AI is not configured' }, { status: 400 })
    }

    try {
      await validateAiCredentials({
        provider: platform.chatProvider,
        model: platform.chatModel,
        apiKey: key.apiKey,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyUnlimited: false,
        autoReplyMaxPerConversation: 3,
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
      console.error('[ai/test] validation error:', err)
      return NextResponse.json(
        { error: 'Could not validate the API key.' },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
