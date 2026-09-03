import {
  formatReplyLanguageInstruction,
  sttHintFromHardLock,
  type ChatLanguageLock,
} from '@/lib/ai/language-lock'
import { buildLiveAiTranscription } from '@/lib/calling/live-ai-constants'
import { liveAiSpokenLanguageBlock } from '@/lib/calling/live-ai-speech-language'

export type LiveAiLanguagePersistPayload = {
  changed?: boolean
  lock?: ChatLanguageLock | null
}

/**
 * Browser-safe Realtime events after the first hard language lock.
 * Updates transcription language only — does not replace session instructions.
 */
export function realtimeLanguageLockEvents(
  lock: ChatLanguageLock,
): Record<string, unknown>[] {
  if (!lock.locked) return []
  const hint = sttHintFromHardLock(lock)
  const events: Record<string, unknown>[] = []
  if (hint) {
    events.push({
      type: 'session.update',
      session: {
        audio: {
          input: {
            transcription: buildLiveAiTranscription(hint.iso),
          },
        },
      },
    })
  }
  const instruction =
    lock.code === 'ml'
      ? liveAiSpokenLanguageBlock(lock)
      : formatReplyLanguageInstruction(lock)
  if (instruction) {
    events.push({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [{ type: 'input_text', text: instruction }],
      },
    })
  }
  return events
}

export function languageLockSessionEventsFromPersist(
  result: LiveAiLanguagePersistPayload | null | undefined,
): Record<string, unknown>[] {
  if (!result?.changed || !result.lock?.locked) return []
  return realtimeLanguageLockEvents(result.lock)
}
