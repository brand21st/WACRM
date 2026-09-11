import { describe, expect, it, vi } from 'vitest'
import type { AiConfig } from '@/lib/ai/types'
import { extractLlmEvents } from './extract-llm'
import { parseLlmSalesEvents } from './sales-event-schema'
import type { AnalyzerMessage } from './extract-deterministic'

const config = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: 'sk-test',
} as AiConfig

const turns: AnalyzerMessage[] = [
  {
    id: 'msg-1',
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'do you offer COD and easy returns?',
    created_at: '2026-01-01T00:00:00.000Z',
  },
]

describe('parseLlmSalesEvents', () => {
  it('keeps valid types and drops unknown / low-confidence items', () => {
    const parsed = parseLlmSalesEvents([
      { type: 'SHIPPING_INQUIRY', confidence: 0.9, metadata: { category: 'shipping' } },
      { type: 'PRODUCT_SELECTED', confidence: 0.99, metadata: {} },
      { type: 'NOT_A_TYPE', confidence: 0.99, metadata: {} },
      { type: 'HESITATION', confidence: 0.2, metadata: {} },
      { type: 'TRUST_CONCERN', confidence: 0.6, metadata: {} },
      {
        type: 'OBJECTION',
        confidence: 1.4,
        metadata: { objectionType: 'price', quote: 'too much', phone: '999' },
      },
    ])
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.map((e) => e.type)).toEqual(['SHIPPING_INQUIRY', 'OBJECTION'])
    expect(parsed.data[1].confidence).toBe(1)
    expect(parsed.data[1].metadata).toEqual({ objectionType: 'price' })
  })

  it('rejects a non-array payload', () => {
    expect(parseLlmSalesEvents({ type: 'INTERESTED' }).success).toBe(false)
  })
})

describe('extractLlmEvents', () => {
  it('inserts rows from valid JSON', async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      text: '```json\n[{"type":"RETURN_INQUIRY","confidence":0.8,"metadata":{}}]\n```',
      usage: null,
    })
    const events = await extractLlmEvents({
      turns,
      config,
      generateStructured,
    })
    expect(generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: expect.any(String) }),
    )
    expect(events.events).toEqual([
      expect.objectContaining({
        eventType: 'RETURN_INQUIRY',
        kind: 'signal',
        sourceMessageId: 'msg-1',
      }),
    ])
    expect(events.status).toBe('success')
  })

  it('writes zero events when JSON is invalid', async () => {
    const events = await extractLlmEvents({
      turns,
      config,
      generateStructured: async () => ({
        text: 'sorry I cannot help',
        usage: null,
      }),
    })
    expect(events.events).toEqual([])
    expect(events.status).toBe('invalid_output')
  })

  it('writes zero events when required fields are missing', async () => {
    const events = await extractLlmEvents({
      turns,
      config,
      generateStructured: async () => ({
        text: '[{"confidence":0.9}]',
        usage: null,
      }),
    })
    expect(events.events).toEqual([])
    expect(events.status).toBe('invalid_output')
  })

  it('marks provider failures as recoverable instead of valid-empty', async () => {
    const result = await extractLlmEvents({
      turns,
      config,
      generateStructured: async () => {
        throw new Error('provider unavailable')
      },
    })
    expect(result).toEqual({
      events: [],
      usage: null,
      status: 'provider_error',
    })
  })
})
