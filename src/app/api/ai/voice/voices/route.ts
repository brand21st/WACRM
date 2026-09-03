import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { requirePlatformElevenLabsKey } from '@/lib/ai/platform-settings'
import { listVoices } from '@/lib/elevenlabs/voices'
import { AiError } from '@/lib/ai/types'

/**
 * GET /api/ai/voice/voices  (admin+)
 *
 * List ElevenLabs voices using the hosted platform key.
 */
export async function GET() {
  try {
    await requireRole('admin')
    const key = await requirePlatformElevenLabsKey()
    if (!key.ok) {
      return NextResponse.json({ error: key.error, code: key.code }, { status: 400 })
    }
    const voices = await listVoices(key.apiKey)
    return NextResponse.json({ voices })
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
