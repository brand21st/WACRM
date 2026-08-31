import { supabaseAdmin } from '@/lib/ai/admin-client'
import { buildMediaPath } from '@/lib/storage/upload-media'
import { extensionForAudioMime, normalizeAudioMime } from './limits'
import { ELEVENLABS_TTS_MIME } from './tts'

const GENERATED_BUCKET = 'chat-media'
const GENERATED_FOLDER = 'generated'

export interface UploadGeneratedAudioArgs {
  accountId: string
  bytes: Uint8Array
  mimeType?: string
  fileName?: string
  /** Injected in tests. */
  storage?: GeneratedAudioStorage
}

export interface UploadGeneratedAudioResult {
  publicUrl: string
  path: string
  mimeType: string
}

/** Narrow storage surface so tests can fake it. */
export interface GeneratedAudioStorage {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array | Buffer,
      options: { contentType: string; cacheControl: string; upsert: boolean },
    ): Promise<{ error: { message: string } | null }>
    getPublicUrl(path: string): { data: { publicUrl: string } }
  }
}

/**
 * Persist TTS output in the public `chat-media` bucket so Meta can
 * fetch it at send time, and so the inbox can play it later. Path is
 * account-scoped (`account-<id>/generated/...`) to match the bucket's
 * RLS write policies.
 */
export async function uploadGeneratedAudio(
  args: UploadGeneratedAudioArgs,
): Promise<UploadGeneratedAudioResult> {
  const mime =
    normalizeAudioMime(args.mimeType) || ELEVENLABS_TTS_MIME
  const ext = extensionForAudioMime(mime)
  const fileName = args.fileName?.trim() || `ai-reply.${ext}`
  const path = buildMediaPath(args.accountId, fileName, Date.now(), GENERATED_FOLDER)

  const storage = args.storage ?? (supabaseAdmin().storage as GeneratedAudioStorage)
  const { error } = await storage.from(GENERATED_BUCKET).upload(path, args.bytes, {
    contentType: mime,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) {
    throw new Error(`Failed to store generated audio: ${error.message}`)
  }

  const {
    data: { publicUrl },
  } = storage.from(GENERATED_BUCKET).getPublicUrl(path)

  return { publicUrl, path, mimeType: mime }
}
