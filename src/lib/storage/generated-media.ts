import { supabaseAdmin } from '@/lib/ai/admin-client'
import { buildMediaPath } from '@/lib/storage/upload-media'

const GENERATED_BUCKET = 'chat-media'
const GENERATED_FOLDER = 'generated'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface GeneratedMediaStorage {
  from(bucket: string): {
    upload(
      path: string,
      body: Uint8Array | Buffer,
      options: { contentType: string; cacheControl: string; upsert: boolean },
    ): Promise<{ error: { message: string } | null }>
    getPublicUrl(path: string): { data: { publicUrl: string } }
  }
}

export interface UploadGeneratedImageArgs {
  accountId: string
  bytes: Uint8Array
  mimeType?: string
  fileName?: string
  storage?: GeneratedMediaStorage
}

export interface UploadGeneratedImageResult {
  publicUrl: string
  path: string
  mimeType: string
}

function normalizeImageMime(raw?: string): string {
  const mime = (raw || '').split(';')[0].trim().toLowerCase()
  if (mime === 'image/png' || mime === 'image/webp' || mime === 'image/gif') {
    return mime
  }
  return 'image/jpeg'
}

function extensionForImageMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'jpg'
}

/**
 * Persist a catalog (or other) image in the public `chat-media` bucket
 * so Meta can fetch it when the Shopify CDN link is rejected.
 */
export async function uploadGeneratedImage(
  args: UploadGeneratedImageArgs,
): Promise<UploadGeneratedImageResult> {
  const mime = normalizeImageMime(args.mimeType)
  const ext = extensionForImageMime(mime)
  const fileName = args.fileName?.trim() || `catalog.${ext}`
  const path = buildMediaPath(args.accountId, fileName, Date.now(), GENERATED_FOLDER)

  const storage = args.storage ?? (supabaseAdmin().storage as GeneratedMediaStorage)
  const { error } = await storage.from(GENERATED_BUCKET).upload(path, args.bytes, {
    contentType: mime,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) {
    throw new Error(`Failed to store catalog image: ${error.message}`)
  }

  const {
    data: { publicUrl },
  } = storage.from(GENERATED_BUCKET).getPublicUrl(path)

  return { publicUrl, path, mimeType: mime }
}

export async function rehostPublicImage(args: {
  accountId: string
  sourceUrl: string
  fetchImpl?: typeof fetch
  storage?: GeneratedMediaStorage
}): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch
  const res = await fetchImpl(args.sourceUrl, {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    throw new Error(`Catalog image download failed: ${res.status}`)
  }
  const mime = normalizeImageMime(res.headers.get('content-type') || undefined)
  const buffer = new Uint8Array(await res.arrayBuffer())
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Catalog image size not sendable: ${buffer.byteLength}`)
  }
  const stored = await uploadGeneratedImage({
    accountId: args.accountId,
    bytes: buffer,
    mimeType: mime,
    fileName: `catalog.${extensionForImageMime(mime)}`,
    storage: args.storage,
  })
  return stored.publicUrl
}
