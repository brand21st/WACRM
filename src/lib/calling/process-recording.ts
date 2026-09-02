import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { canTranscribe, transcribeSpeech } from '@/lib/ai/speech'
import { generateReply } from '@/lib/ai/generate'
import { CALL_RECORDINGS_BUCKET } from '@/lib/calling/storage'
import { engineSendText } from '@/lib/flows/meta-send'
import type { Call, CallingSettings } from '@/types'

export async function processCallRecording(args: {
  accountId: string
  callId: string
  settings: CallingSettings
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: call, error } = await db
    .from('calls')
    .select('*')
    .eq('id', args.callId)
    .eq('account_id', args.accountId)
    .maybeSingle()

  if (error || !call) return
  const row = call as Call
  if (!row.recording_key) return

  if (!args.settings.transcribe_enabled) {
    await db
      .from('calls')
      .update({ transcript_status: 'skipped', ai_status: 'skipped' })
      .eq('id', row.id)
    return
  }

  await db.from('calls').update({ transcript_status: 'pending' }).eq('id', row.id)

  const config = await loadAiConfig(db, args.accountId, { requireActive: false })
  if (!config || !canTranscribe(config)) {
    await db
      .from('calls')
      .update({ transcript_status: 'skipped', ai_status: 'skipped' })
      .eq('id', row.id)
    return
  }

  const { data: file, error: dlError } = await db.storage
    .from(CALL_RECORDINGS_BUCKET)
    .download(row.recording_key)

  if (dlError || !file) {
    await db.from('calls').update({ transcript_status: 'failed' }).eq('id', row.id)
    return
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const transcript = await transcribeSpeech({
      config,
      audio: buffer,
      mimeType: file.type || 'audio/webm',
      fileName: `${row.id}.webm`,
    })
    await db
      .from('calls')
      .update({
        transcript: transcript || null,
        transcript_status: transcript ? 'ready' : 'failed',
      })
      .eq('id', row.id)

    if (!transcript || !args.settings.ai_enabled) {
      await db
        .from('calls')
        .update({ ai_status: transcript ? 'skipped' : 'failed' })
        .eq('id', row.id)
      return
    }

    await generatePostCallAi({
      accountId: args.accountId,
      call: { ...row, transcript },
      settings: args.settings,
    })
  } catch {
    await db.from('calls').update({ transcript_status: 'failed' }).eq('id', row.id)
  }
}

async function generatePostCallAi(args: {
  accountId: string
  call: Call
  settings: CallingSettings
}) {
  const db = supabaseAdmin()
  const config = await loadAiConfig(db, args.accountId, { requireActive: false })
  if (!config) {
    await db.from('calls').update({ ai_status: 'skipped' }).eq('id', args.call.id)
    return
  }

  await db.from('calls').update({ ai_status: 'pending' }).eq('id', args.call.id)
  try {
    const systemPrompt = [
      config.systemPrompt || 'You are a CRM assistant for a WhatsApp business.',
      'The following is a transcript of a voice call with a customer.',
      'Reply as JSON only: {"summary": string, "followup": string}.',
      'summary: 2-4 sentences of what was discussed.',
      'followup: one WhatsApp message the agent could send next. Empty string if none.',
    ].join(' ')

    const result = await generateReply({
      config,
      systemPrompt,
      messages: [
        {
          role: 'user',
          content: args.call.transcript || '',
        },
      ],
    })

    let summary = result.text.trim()
    let followup = ''
    try {
      const parsed = JSON.parse(result.text) as { summary?: string; followup?: string }
      summary = parsed.summary?.trim() || summary
      followup = parsed.followup?.trim() || ''
    } catch {
      // model returned prose
    }

    await db
      .from('calls')
      .update({
        ai_summary: summary,
        ai_followup_draft: followup || null,
        ai_status: 'ready',
      })
      .eq('id', args.call.id)

    if (
      args.settings.ai_auto_send_followup &&
      followup &&
      args.call.contact_id &&
      args.call.conversation_id &&
      args.call.answered_by
    ) {
      await engineSendText({
        accountId: args.accountId,
        userId: args.call.answered_by,
        contactId: args.call.contact_id,
        conversationId: args.call.conversation_id,
        text: followup,
        aiGenerated: true,
      })
    }
  } catch {
    await db.from('calls').update({ ai_status: 'failed' }).eq('id', args.call.id)
  }
}
