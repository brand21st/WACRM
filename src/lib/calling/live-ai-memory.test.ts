import { describe, it, expect } from 'vitest'
import {
  detectLiveAiLanguageHint,
  formatLiveAiMemoryBlock,
  isLiveAiNoiseTranscript,
  memoryLinesFromThread,
  searchLiveAiMemory,
} from './live-ai-memory'

describe('live AI customer memory', () => {
  it('drops Meta recording notices and call status lines', () => {
    expect(
      isLiveAiNoiseTranscript(
        'This call will be recorded for the following purpose: quality',
      ),
    ).toBe(true)
    expect(isLiveAiNoiseTranscript('call:completed')).toBe(true)
    expect(isLiveAiNoiseTranscript('I need a black bag')).toBe(false)
  })

  it('keeps real chat and detects Malayalam', () => {
    const thread = memoryLinesFromThread([
      { role: 'user', content: 'This call will be recorded for the following purpose: quality' },
      { role: 'user', content: 'എനിക്ക് ഒരു ബാഗ് വേണം' },
      { role: 'assistant', content: 'Sure, I can help.' },
    ])
    expect(thread).toEqual([
      { role: 'customer', text: 'എനിക്ക് ഒരു ബാഗ് വേണം' },
      { role: 'assistant', text: 'Sure, I can help.' },
    ])
    expect(detectLiveAiLanguageHint(thread)).toBe('Malayalam')
  })

  it('formats notes, thread, and language for the spoken prompt', () => {
    const block = formatLiveAiMemoryBlock({
      notes: ['Prefers WhatsApp, VIP'],
      thread: [{ role: 'customer', text: 'Need the black bag' }],
      recall: [{ role: 'customer', text: 'Need the black bag' }],
      languageHint: 'Malayalam',
      replyLanguage: {
        code: 'ml',
        name: 'Malayalam',
        script: 'native',
        locked: true,
      },
    })
    expect(block).toContain('Prefers WhatsApp, VIP')
    expect(block).toContain('Customer: Need the black bag')
    expect(block).toContain('Locked reply language: Malayalam')
    expect(block).toContain('do not re-ask')
  })

  it('includes stored chat-session profile', () => {
    const block = formatLiveAiMemoryBlock({
      notes: [],
      thread: [],
      recall: [],
      languageHint: null,
      stored: {
        profileSummary: 'Wants a black tote',
        lastSessionSummary: 'Asked about stock yesterday',
        facts: {
          intent: 'buy',
          products: ['black tote'],
          preferences: [],
          language: 'English',
          language_code: 'en',
          language_script: 'latin',
          language_locked: true,
          open_questions: [],
        },
        notes: [],
        summarizedThroughAt: null,
        messageCountAtSummary: 4,
        conversationId: 'c1',
      },
    })
    expect(block).toContain('Wants a black tote')
    expect(block).toContain('Asked about stock yesterday')
  })

  it('searches notes and older recall lines', () => {
    const hits = searchLiveAiMemory(
      {
        notes: ['Ordered SKU BAG-9 last week'],
        thread: [{ role: 'customer', text: 'hello' }],
        recall: [
          { role: 'customer', text: 'I want the black tote' },
          { role: 'customer', text: 'hello' },
        ],
      },
      'black tote SKU',
    )
    expect(hits.some((h) => h.includes('BAG-9'))).toBe(true)
    expect(hits.some((h) => h.includes('black tote'))).toBe(true)
  })
})
