import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { isCatalogSchemaError, catalogSchemaMissingResponse } from '@/lib/catalog/http'
import { isAccountCatalogStoragePath } from '@/lib/catalog'
import { buildMediaPath, MEDIA_MAX_BYTES_BY_KIND } from '@/lib/storage/upload-media'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const CHAT_MEDIA_BUCKET = 'chat-media'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-media:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Choose an image to upload' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'Use a JPEG, PNG, or WebP image' }, { status: 400 })
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      return NextResponse.json({ error: 'Image must be 5 MB or smaller' }, { status: 400 })
    }

    const path = buildMediaPath(accountId, file.name, Date.now(), 'catalog')
    if (!isAccountCatalogStoragePath(accountId, path)) {
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })
    }

    const { error: upErr } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type,
    })
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 })
    }
    const {
      data: { publicUrl },
    } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)

    return NextResponse.json({ url: publicUrl, path })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}
