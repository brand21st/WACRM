import { after, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { ensureCallingSettings } from '@/lib/calling/settings'
import {
  CALL_RECORDINGS_BUCKET,
  recordingContentType,
  recordingObjectPath,
} from '@/lib/calling/storage'
import { processCallRecording } from '@/lib/calling/process-recording'
import { enqueueCallRecording } from '@/lib/queue/enqueue'

export async function POST(
  request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const { callId } = await context.params
    const limited = checkRateLimit(`call-rec:${userId}`, RATE_LIMITS.callRecording)
    if (!limited.success) return rateLimitResponse(limited)

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof Blob) || file.size < 64) {
      return NextResponse.json({ error: 'Recording is missing' }, { status: 400 })
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'Recording is too large' }, { status: 413 })
    }

    const db = supabaseAdmin()
    const { data: call } = await db
      .from('calls')
      .select('id, account_id, answered_by')
      .eq('id', callId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!call) {
      return NextResponse.json({ error: 'Call not found' }, { status: 404 })
    }
    if (call.answered_by && call.answered_by !== userId) {
      return NextResponse.json({ error: 'Only the answering agent can upload' }, { status: 403 })
    }

    const settings = await ensureCallingSettings(db, accountId)
    if (!settings.recording_enabled) {
      return NextResponse.json({ error: 'Recording is disabled' }, { status: 400 })
    }

    const path = recordingObjectPath(accountId, callId)
    const buffer = Buffer.from(await file.arrayBuffer())
    const contentType = recordingContentType(file.type)
    const { error: upErr } = await db.storage.from(CALL_RECORDINGS_BUCKET).upload(path, buffer, {
      contentType,
      upsert: true,
    })
    if (upErr) {
      console.error('[calling] recording upload failed', upErr)
      return NextResponse.json({ error: 'Failed to store recording' }, { status: 500 })
    }

    const { data: signed } = await db.storage
      .from(CALL_RECORDINGS_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 7)

    const { error: dbErr } = await db
      .from('calls')
      .update({
        recording_key: path,
        recording_url: signed?.signedUrl ?? null,
        recording_bytes: buffer.byteLength,
        recorded_at: new Date().toISOString(),
        consent_announced: form.get('consent') === '1',
      })
      .eq('id', callId)
    if (dbErr) {
      console.error('[calling] recording metadata update failed', dbErr)
      return NextResponse.json({ error: 'Failed to save recording' }, { status: 500 })
    }

    const queued = await enqueueCallRecording({ accountId, callId })
    if (!queued) {
      after(() =>
        processCallRecording({ accountId, callId, settings }).catch((err) => {
          console.error('[calling] post-recording pipeline', err)
        }),
      )
    }

    return NextResponse.json({ ok: true, recording_key: path })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { callId } = await context.params
    const { data: call } = await supabase
      .from('calls')
      .select('id, recording_key')
      .eq('id', callId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!call?.recording_key) {
      return NextResponse.json({ error: 'No recording' }, { status: 404 })
    }

    const db = supabaseAdmin()
    const { data, error } = await db.storage
      .from(CALL_RECORDINGS_BUCKET)
      .createSignedUrl(call.recording_key, 60 * 30)

    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: 'Could not sign recording' }, { status: 500 })
    }
    return NextResponse.json({ url: data.signedUrl })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  try {
    const { accountId } = await requireRole('admin')
    const { callId } = await context.params
    const db = supabaseAdmin()
    const { data: call } = await db
      .from('calls')
      .select('recording_key')
      .eq('id', callId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (call?.recording_key) {
      await db.storage.from(CALL_RECORDINGS_BUCKET).remove([call.recording_key])
    }
    await db
      .from('calls')
      .update({
        recording_key: null,
        recording_url: null,
        recording_bytes: null,
        recorded_at: null,
      })
      .eq('id', callId)
      .eq('account_id', accountId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
