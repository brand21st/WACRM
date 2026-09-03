import { describe, expect, it } from 'vitest'
import {
  languageLockSessionEventsFromPersist,
  realtimeLanguageLockEvents,
} from './live-ai-language-session'

const malayalamLock = {
  code: 'ml' as const,
  name: 'Malayalam',
  script: 'native' as const,
  locked: true,
}

describe('realtimeLanguageLockEvents', () => {
  it('updates transcription language and adds the lock instruction', () => {
    const events = realtimeLanguageLockEvents(malayalamLock)
    expect(events).toEqual([
      {
        type: 'session.update',
        session: {
          audio: {
            input: {
              transcription: {
                model: 'gpt-live-transcribe',
                delay: 'medium',
                prompt: expect.stringContaining('Kerala Malayalam'),
                languages: ['ml', 'en'],
              },
            },
          },
        },
      },
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'system',
          content: [
            expect.objectContaining({
              type: 'input_text',
              text: expect.stringContaining('This WhatsApp voice call is in Malayalam'),
            }),
          ],
        },
      },
    ])
  })

  it('sends session.update when the transcript API reports changed', () => {
    expect(languageLockSessionEventsFromPersist({ changed: false, lock: malayalamLock })).toEqual([])
    expect(languageLockSessionEventsFromPersist({ changed: true, lock: null })).toEqual([])
    const events = languageLockSessionEventsFromPersist({
      changed: true,
      lock: malayalamLock,
    })
    expect(events[0]).toMatchObject({
      type: 'session.update',
      session: {
        audio: { input: { transcription: { model: 'gpt-live-transcribe', languages: ['ml', 'en'] } } },
      },
    })
  })
})
