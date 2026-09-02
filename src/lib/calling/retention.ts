import { supabaseAdmin } from '@/lib/ai/admin-client'
import { CALL_RECORDINGS_BUCKET } from '@/lib/calling/storage'

export async function expireCallRecordings(): Promise<{ deleted: number }> {
  const db = supabaseAdmin()
  const { data: settingsRows, error } = await db
    .from('calling_settings')
    .select('account_id, retention_days')

  if (error || !settingsRows?.length) return { deleted: 0 }

  let deleted = 0
  for (const row of settingsRows) {
    const days = row.retention_days as number
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const { data: expired } = await db
      .from('calls')
      .select('id, recording_key')
      .eq('account_id', row.account_id)
      .not('recording_key', 'is', null)
      .lt('recorded_at', cutoff)

    for (const call of expired ?? []) {
      if (call.recording_key) {
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
        .eq('id', call.id)
      deleted += 1
    }
  }
  return { deleted }
}
