import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { MEDIA_CAPTION_MAX } from '@/lib/storage/upload-media'
import type { QuickReplyKind } from '@/types'

export const QUICK_REPLY_KINDS = [
  'text',
  'interactive',
  'image',
  'video',
  'document',
] as const satisfies readonly QuickReplyKind[]

export const MEDIA_QUICK_REPLY_KINDS = ['image', 'video', 'document'] as const

export function isQuickReplyKind(value: unknown): value is QuickReplyKind {
  return (
    typeof value === 'string' &&
    (QUICK_REPLY_KINDS as readonly string[]).includes(value)
  )
}

export function isMediaQuickReplyKind(
  value: unknown,
): value is (typeof MEDIA_QUICK_REPLY_KINDS)[number] {
  return (
    value === 'image' || value === 'video' || value === 'document'
  )
}

export interface QuickReplyContentFields {
  kind: QuickReplyKind
  content_text: string | null
  interactive_payload: unknown
  media_url: string | null
  media_path: string | null
  media_filename: string | null
}

export function parseQuickReplyContent(
  body: Record<string, unknown>,
  kind: QuickReplyKind,
): { ok: true; fields: QuickReplyContentFields } | { ok: false; error: string } {
  if (kind === 'interactive') {
    const result = validateInteractivePayload(body.interactive_payload)
    if (!result.ok) return { ok: false, error: result.error }
    return {
      ok: true,
      fields: {
        kind,
        content_text: null,
        interactive_payload: body.interactive_payload,
        media_url: null,
        media_path: null,
        media_filename: null,
      },
    }
  }

  if (isMediaQuickReplyKind(kind)) {
    const media_url =
      typeof body.media_url === 'string' ? body.media_url.trim() : ''
    const media_path =
      typeof body.media_path === 'string' ? body.media_path.trim() : ''
    if (!media_url || !media_path) {
      return {
        ok: false,
        error: 'media_url and media_path are required for media quick replies',
      }
    }
    const caption =
      typeof body.content_text === 'string' ? body.content_text.trim() : ''
    if (caption.length > MEDIA_CAPTION_MAX) {
      return {
        ok: false,
        error: `caption must be at most ${MEDIA_CAPTION_MAX} characters`,
      }
    }
    const media_filename =
      typeof body.media_filename === 'string' && body.media_filename.trim()
        ? body.media_filename.trim()
        : null
    return {
      ok: true,
      fields: {
        kind,
        content_text: caption || null,
        interactive_payload: null,
        media_url,
        media_path,
        media_filename,
      },
    }
  }

  const text = typeof body.content_text === 'string' ? body.content_text : ''
  if (!text.trim()) {
    return {
      ok: false,
      error: 'content_text is required for text quick replies',
    }
  }
  return {
    ok: true,
    fields: {
      kind: 'text',
      content_text: text,
      interactive_payload: null,
      media_url: null,
      media_path: null,
      media_filename: null,
    },
  }
}
