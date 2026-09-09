import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/upload-media'
import {
  isQuickReplyKind,
  parseQuickReplyContent,
} from '@/lib/quick-replies'

// Update / delete a single quick reply. Quick replies are account-
// shared, so every mutation is scoped by `account_id` (the service-role
// client bypasses the agent-gated RLS, so both the role check and the
// account scope are enforced here).

async function gcChatMedia(path: string | null | undefined) {
  if (!path) return
  await supabaseAdmin()
    .storage.from(CHAT_MEDIA_BUCKET)
    .remove([path])
    .catch(() => {})
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const { data: existing, error: existingErr } = await supabaseAdmin()
    .from('quick_replies')
    .select('media_path')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'Quick reply not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  if (typeof body.title === 'string') {
    const title = body.title.trim()
    if (!title) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 })
    update.title = title
  }

  // When `kind` is supplied (e.g. the editor flips Text ↔ Image), it
  // drives which content columns are authoritative and the others are
  // cleared — otherwise a switched row keeps a stale payload the picker
  // mis-routes on.
  if ('kind' in body) {
    if (!isQuickReplyKind(body.kind)) {
      return NextResponse.json(
        { error: 'kind must be text, interactive, image, video, or document' },
        { status: 400 },
      )
    }
    const parsed = parseQuickReplyContent(body, body.kind)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    Object.assign(update, parsed.fields)
  } else {
    // No kind change — allow partial edits of whichever field the row uses.
    if ('content_text' in body) update.content_text = body.content_text ?? null
    if ('interactive_payload' in body) {
      const parsed = parseQuickReplyContent(
        { ...body, kind: 'interactive', interactive_payload: body.interactive_payload },
        'interactive',
      )
      if (body.interactive_payload != null && !parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      update.interactive_payload = body.interactive_payload ?? null
    }
    if ('media_url' in body) update.media_url = body.media_url ?? null
    if ('media_path' in body) update.media_path = body.media_path ?? null
    if ('media_filename' in body) {
      update.media_filename = body.media_filename ?? null
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabaseAdmin()
    .from('quick_replies')
    .update(update)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const nextPath =
    typeof update.media_path === 'string' ? update.media_path : null
  const prevPath = existing.media_path as string | null
  if (prevPath && prevPath !== nextPath && ('kind' in body || 'media_path' in body)) {
    void gcChatMedia(prevPath)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const { data: existing, error: existingErr } = await supabaseAdmin()
    .from('quick_replies')
    .select('media_path')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (existingErr) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'Quick reply not found' }, { status: 404 })
  }

  const { error } = await supabaseAdmin()
    .from('quick_replies')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  void gcChatMedia(existing.media_path as string | null)
  return NextResponse.json({ ok: true })
}
