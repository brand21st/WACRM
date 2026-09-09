import {
  CHAT_MEDIA_BUCKET,
  deleteAccountMedia,
  uploadAccountMedia,
} from '@/lib/storage/upload-media'
import type { QuickReplyMessageDraft } from '@/lib/quick-reply-from-message'
import type { QuickReplyKind } from '@/types'

export interface CreateQuickReplyInput {
  title: string
  kind: QuickReplyKind
  content_text?: string | null
  interactive_payload?: unknown
  media_url?: string | null
  media_path?: string | null
  media_filename?: string | null
}

/**
 * POST /api/quick-replies. Returns the server error string on failure
 * so callers can toast it (or fall back to their own copy).
 */
export async function createQuickReply(
  input: CreateQuickReplyInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = input.title.trim()
  if (!title) return { ok: false, error: 'title is required' }
  try {
    const res = await fetch('/api/quick-replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        kind: input.kind,
        content_text: input.content_text,
        interactive_payload: input.interactive_payload,
        media_url: input.media_url,
        media_path: input.media_path,
        media_filename: input.media_filename,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      return { ok: false, error: data.error ?? 'Could not save the quick reply' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not save the quick reply' }
  }
}

/**
 * Copy a chat attachment into a *new* chat-media object so the QR owns
 * its file. Sharing the message path would let QR delete GC the bubble.
 */
export async function copyChatMediaForQuickReply(
  sourceUrl: string,
  filename: string,
  sourceMessageId?: string,
): Promise<{ publicUrl: string; path: string }> {
  try {
    const res = await fetch(sourceUrl, { credentials: 'include' })
    if (!res.ok) throw new Error('unavailable')
    const blob = await res.blob()
    if (blob.size === 0) throw new Error('unavailable')
    const type =
      blob.type && blob.type !== 'application/octet-stream'
        ? blob.type
        : undefined
    const file = new File([blob], filename, {
      type: type ?? 'application/octet-stream',
    })
    return await uploadAccountMedia(CHAT_MEDIA_BUCKET, file)
  } catch (err) {
    if (!sourceMessageId) {
      throw err instanceof Error
        ? err
        : new Error('This attachment is no longer available.')
    }
    return copyChatMediaViaServer(sourceMessageId)
  }
}

async function copyChatMediaViaServer(
  messageId: string,
): Promise<{ publicUrl: string; path: string }> {
  const res = await fetch('/api/quick-replies/copy-media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_id: messageId }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    publicUrl?: string
    path?: string
    error?: string
  }
  if (!res.ok || !data.publicUrl || !data.path) {
    throw new Error(data.error ?? 'This attachment is no longer available.')
  }
  return { publicUrl: data.publicUrl, path: data.path }
}

/**
 * Copy media if needed, then POST. Call after the user has named the reply.
 */
export async function commitQuickReplyDraft(
  draft: Extract<QuickReplyMessageDraft, { ok: true }>,
  title: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (draft.kind === 'text') {
    return createQuickReply({
      title,
      kind: 'text',
      content_text: draft.content_text,
    })
  }
  if (draft.kind === 'interactive') {
    return createQuickReply({
      title,
      kind: 'interactive',
      interactive_payload: draft.interactive_payload,
    })
  }

  let uploaded: { publicUrl: string; path: string } | null = null
  try {
    uploaded = await copyChatMediaForQuickReply(
      draft.media_url,
      draft.media_filename,
      draft.sourceMessageId,
    )
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'This attachment is no longer available.',
    }
  }

  const result = await createQuickReply({
    title,
    kind: draft.kind,
    content_text: draft.content_text,
    media_url: uploaded.publicUrl,
    media_path: uploaded.path,
    media_filename: draft.media_filename,
  })
  if (!result.ok) {
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, uploaded.path)
  }
  return result
}
