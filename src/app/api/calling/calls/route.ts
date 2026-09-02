import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const url = new URL(request.url)
    const kind = url.searchParams.get('kind') // recording | transcript | ai
    const q = url.searchParams.get('q')?.trim() ?? ''
    const safe = q.replace(/[%_,()]/g, '').slice(0, 80)

    let query = supabase
      .from('calls')
      .select(
        'id, status, duration_seconds, created_at, from_phone, conversation_id, recording_key, recorded_at, transcript, transcript_status, ai_summary, ai_followup_draft, ai_status, contact:contacts(name, phone)',
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(80)

    if (kind === 'recording') query = query.not('recording_key', 'is', null)
    if (kind === 'transcript') query = query.not('transcript', 'is', null)
    if (kind === 'ai') query = query.not('ai_summary', 'is', null)
    if (safe) {
      query = query.or(
        `from_phone.ilike.%${safe}%,transcript.ilike.%${safe}%,ai_summary.ilike.%${safe}%`,
      )
    }

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ error: 'Failed to load calls' }, { status: 500 })
    }
    return NextResponse.json({ calls: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
