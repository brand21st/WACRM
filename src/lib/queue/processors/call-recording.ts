import { supabaseAdmin } from '@/lib/ai/admin-client'
import { processCallRecording } from '@/lib/calling/process-recording'
import { ensureCallingSettings } from '@/lib/calling/settings'
import type { CallRecordingJob } from '@/lib/queue/jobs'

export async function processCallRecordingJob(
  job: CallRecordingJob,
): Promise<void> {
  const db = supabaseAdmin()
  const settings = await ensureCallingSettings(db, job.accountId)
  await processCallRecording({
    accountId: job.accountId,
    callId: job.callId,
    settings,
  })
}
