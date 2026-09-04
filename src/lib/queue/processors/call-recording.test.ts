import { beforeEach, describe, expect, it, vi } from 'vitest'

const processCallRecording = vi.fn()
const ensureCallingSettings = vi.fn()
const supabaseAdmin = vi.fn()

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => supabaseAdmin(),
}))

vi.mock('@/lib/calling/process-recording', () => ({
  processCallRecording: (...args: unknown[]) => processCallRecording(...args),
}))

vi.mock('@/lib/calling/settings', () => ({
  ensureCallingSettings: (...args: unknown[]) => ensureCallingSettings(...args),
}))

import { processCallRecordingJob } from './call-recording'

describe('processCallRecordingJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseAdmin.mockReturnValue({ tagged: 'db' })
    ensureCallingSettings.mockResolvedValue({ transcribe_enabled: true })
    processCallRecording.mockResolvedValue(undefined)
  })

  it('reloads calling settings then runs the recording pipeline', async () => {
    await processCallRecordingJob({ accountId: 'acc-1', callId: 'call-1' })
    expect(ensureCallingSettings).toHaveBeenCalledWith({ tagged: 'db' }, 'acc-1')
    expect(processCallRecording).toHaveBeenCalledWith({
      accountId: 'acc-1',
      callId: 'call-1',
      settings: { transcribe_enabled: true },
    })
  })
})
