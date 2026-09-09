import { mediaFilename } from '@/lib/media/filename'
import { MEDIA_CAPTION_MAX } from '@/lib/storage/upload-media'
import { isMediaQuickReplyKind } from '@/lib/quick-replies'
import {
  interactivePayloadPreviewText,
  validateInteractivePayload,
} from '@/lib/whatsapp/interactive'
import type { Message, QuickReplyKind } from '@/types'

const TITLE_MAX = 60

export type QuickReplyMessageDraft =
  | {
      ok: true
      kind: 'text'
      content_text: string
      defaultTitle: string
    }
  | {
      ok: true
      kind: 'interactive'
      interactive_payload: unknown
      defaultTitle: string
    }
  | {
      ok: true
      kind: 'image' | 'video' | 'document'
      media_url: string
      content_text: string | null
      media_filename: string
      defaultTitle: string
      /** Thread message id — used to copy media server-side when the
       *  browser cannot fetch the URL (Shopify CDN CORS, expired proxy). */
      sourceMessageId: string
    }
  | { ok: false }

/**
 * Whether the hover toolbar should offer “save as quick reply”.
 * Audio, location, call, order, and empty/unusable bubbles are excluded.
 */
export function canSaveMessageAsQuickReply(message: Message): boolean {
  return quickReplyDraftFromMessage(message).ok
}

/**
 * Map a thread message onto a quick-reply draft. Media drafts still need
 * a *new* chat-media copy before POST — never reuse the message’s path,
 * or deleting the QR would GC the original bubble.
 */
export function quickReplyDraftFromMessage(
  message: Message,
): QuickReplyMessageDraft {
  const type = message.content_type

  if (
    type === 'audio' ||
    type === 'location' ||
    type === 'call' ||
    type === 'order'
  ) {
    return { ok: false }
  }

  if (isMediaQuickReplyKind(type)) {
    const media_url = message.media_url?.trim() ?? ''
    if (!media_url) return { ok: false }
    const filename = mediaFilename({
      content_type: type,
      content_text: message.content_text,
      media_url: message.media_url,
      media_type: message.media_type,
      created_at: message.created_at,
    })
    const caption = mediaCaption(type, message.content_text)
    return {
      ok: true,
      kind: type,
      media_url,
      content_text: caption,
      media_filename: filename,
      defaultTitle: clipTitle(stem(filename) || kindTitle(type)),
      sourceMessageId: message.id,
    }
  }

  if (type === 'interactive') {
    const payload = message.interactive_payload
    if (payload && validateInteractivePayload(payload).ok) {
      return {
        ok: true,
        kind: 'interactive',
        interactive_payload: payload,
        defaultTitle: clipTitle(
          interactivePayloadPreviewText(payload) || 'Interactive',
        ),
      }
    }
    const text = message.content_text?.trim() ?? ''
    if (!text) return { ok: false }
    return {
      ok: true,
      kind: 'text',
      content_text: message.content_text ?? text,
      defaultTitle: clipTitle(firstLine(text)),
    }
  }

  const text =
    (typeof message.content_text === 'string' ? message.content_text : '') ||
    (type === 'template' ? message.template_name ?? '' : '')
  if (!text.trim()) return { ok: false }
  return {
    ok: true,
    kind: 'text',
    content_text: text,
    defaultTitle: clipTitle(firstLine(text.trim())),
  }
}

function mediaCaption(
  kind: 'image' | 'video' | 'document',
  raw: string | undefined,
): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Documents store the original filename in content_text when there is
  // no caption. Don't treat that as WhatsApp caption text.
  if (kind === 'document' && looksLikeFilename(trimmed)) return null
  return trimmed.length > MEDIA_CAPTION_MAX
    ? trimmed.slice(0, MEDIA_CAPTION_MAX)
    : trimmed
}

function looksLikeFilename(text: string): boolean {
  return !text.includes('\n') && /\.[A-Za-z0-9]{1,8}$/.test(text)
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() ?? ''
}

function stem(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim()
}

function kindTitle(kind: QuickReplyKind): string {
  if (kind === 'image') return 'Image'
  if (kind === 'video') return 'Video'
  if (kind === 'document') return 'Document'
  if (kind === 'interactive') return 'Interactive'
  return 'Message'
}

function clipTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= TITLE_MAX) return collapsed
  return collapsed.slice(0, TITLE_MAX).trimEnd()
}
