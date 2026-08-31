import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { listVoices } from '@/lib/elevenlabs/voices'
import { AiError } from '@/lib/ai/types'

async function storedElevenLabsKey(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('ai_configs')
    .select('elevenlabs_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data?.elevenlabs_api_key) return null
  try {
    return decrypt(data.elevenlabs_api_key)
  } catch {
    return null
  }
}

/**
 * GET /api/ai/voice/voices  (admin+)
 *
 * List ElevenLabs voices for the stored key. Used by Clone and Training.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const apiKey = await storedElevenLabsKey(supabase, accountId)
    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'Add an ElevenLabs key on Voice Agent → Build first.',
          code: 'voice_not_configured',
        },
        { status: 400 },
      )
    }
    const voices = await listVoices(apiKey)
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
