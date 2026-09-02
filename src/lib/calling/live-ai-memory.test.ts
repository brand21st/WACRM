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
    })
    expect(block).toContain('Prefers WhatsApp, VIP')
    expect(block).toContain('Customer: Need the black bag')
    expect(block).toContain('speaking Malayalam')
    expect(block).toContain('do not re-ask')
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
