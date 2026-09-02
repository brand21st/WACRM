import { describe, it, expect } from 'vitest'
import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import {
  functionCallsFromOutput,
  interpretRealtimeEvent,
} from './live-ai-realtime'

describe('interpretRealtimeEvent', () => {
  it('reads caller transcripts', () => {
    expect(
      interpretRealtimeEvent({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: '  hello  ',
        item_id: 'item_u',
      }),
    ).toEqual({
      type: 'customer_transcript',
      text: 'hello',
      itemId: 'item_u',
    })
  })

  it('reads assistant transcripts and detects handoff', () => {
    expect(
      interpretRealtimeEvent({
        type: 'response.output_audio_transcript.done',
        transcript: `Okay ${HANDOFF_SENTINEL}`,
        item_id: 'item_a',
      }),
    ).toEqual({
      type: 'bot_transcript',
      text: 'Okay',
      itemId: 'item_a',
      handoff: true,
    })
  })

  it('extracts function calls from response.done', () => {
    const action = interpretRealtimeEvent({
      type: 'response.done',
      response: {
        output: [
          {
            type: 'function_call',
            name: 'transfer_to_human',
            call_id: 'call_1',
            arguments: '{}',
          },
        ],
      },
    })
    expect(action).toEqual({
      type: 'function_calls',
      calls: [{ name: 'transfer_to_human', callId: 'call_1', arguments: '{}' }],
    })
  })

  it('surfaces Realtime errors', () => {
    expect(
      interpretRealtimeEvent({
        type: 'error',
        error: { message: 'rate limited' },
      }),
    ).toEqual({ type: 'error', message: 'rate limited' })
  })
})

describe('functionCallsFromOutput', () => {
  it('ignores non-function items', () => {
    expect(
      functionCallsFromOutput([{ type: 'message' }, { type: 'function_call', name: '', call_id: 'x' }]),
    ).toEqual([])
  })
})
