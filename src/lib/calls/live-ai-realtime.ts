import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import { TRANSFER_TO_HUMAN_TOOL } from '@/lib/calling/live-ai-constants'
import {
  createCallerAudioBridge,
  type AiOutbound,
  type CallerAudioBridge,
} from './ai-media'
import { normalizeOfferSdp } from './sdp'
import { closePeer, ICE_SERVERS, waitForIceGathering } from './webrtc'

function parseSpoken(raw: string): { text: string; handoff: boolean } {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff }
}

export type LiveAiRealtimeHandlers = {
  onTranscript: (role: 'customer' | 'bot', text: string) => void
  onHandoff: () => void
  onError: (message: string) => void
}

export type RealtimeFunctionCall = {
  name: string
  callId: string
  arguments: string
}

export type RealtimeEventAction =
  | { type: 'ignore' }
  | { type: 'customer_transcript'; text: string; itemId?: string }
  | { type: 'bot_transcript'; text: string; itemId?: string; handoff: boolean }
  | { type: 'function_calls'; calls: RealtimeFunctionCall[] }
  | { type: 'error'; message: string }

export function functionCallsFromOutput(output: unknown): RealtimeFunctionCall[] {
  if (!Array.isArray(output)) return []
  const calls: RealtimeFunctionCall[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const row = item as {
      type?: unknown
      name?: unknown
      call_id?: unknown
      arguments?: unknown
    }
    if (row.type !== 'function_call') continue
    const name = typeof row.name === 'string' ? row.name : ''
    const callId = typeof row.call_id === 'string' ? row.call_id : ''
    const args = typeof row.arguments === 'string' ? row.arguments : '{}'
    if (name && callId) calls.push({ name, callId, arguments: args })
  }
  return calls
}

export function interpretRealtimeEvent(
  payload: Record<string, unknown>,
): RealtimeEventAction {
  const type = typeof payload.type === 'string' ? payload.type : ''
  if (type === 'error') {
    const err = payload.error as { message?: string } | undefined
    return { type: 'error', message: err?.message || 'OpenAI Realtime error' }
  }

  if (
    type === 'conversation.item.input_audio_transcription.completed' ||
    type === 'conversation.item.input_audio_transcription.done'
  ) {
    const text =
      typeof payload.transcript === 'string'
        ? payload.transcript
        : typeof (payload.item as { transcript?: string } | undefined)?.transcript ===
            'string'
          ? (payload.item as { transcript: string }).transcript
          : ''
    const itemId = typeof payload.item_id === 'string' ? payload.item_id : undefined
    if (!text.trim()) return { type: 'ignore' }
    return { type: 'customer_transcript', text: text.trim(), itemId }
  }

  if (
    type === 'response.output_audio_transcript.done' ||
    type === 'response.audio_transcript.done'
  ) {
    const text = typeof payload.transcript === 'string' ? payload.transcript.trim() : ''
    if (!text) return { type: 'ignore' }
    const parsed = parseSpoken(text)
    return {
      type: 'bot_transcript',
      text: parsed.text || text,
      itemId: typeof payload.item_id === 'string' ? payload.item_id : undefined,
      handoff: parsed.handoff,
    }
  }

  if (type === 'response.done') {
    const response = (payload.response ?? {}) as { output?: unknown }
    const calls = functionCallsFromOutput(response.output)
    if (calls.length > 0) return { type: 'function_calls', calls }
    return { type: 'ignore' }
  }

  return { type: 'ignore' }
}

export class LiveAiRealtimeSession {
  private stopped = false
  private pc: RTCPeerConnection | null = null
  private dc: RTCDataChannel | null = null
  private remote: MediaStream | null
  private sender: RTCRtpSender | null = null
  private callerBridge: CallerAudioBridge | null = null
  private greeted = false
  private handoffSent = false
  private greetWhenReady = false

  constructor(
    private readonly callId: string,
    private readonly outbound: AiOutbound,
    remote: MediaStream | null,
    private readonly handlers: LiveAiRealtimeHandlers,
  ) {
    this.remote = remote
  }

  setRemote(stream: MediaStream) {
    this.remote = stream
    this.wireCallerStream(stream)
  }

  start() {
    if (this.pc || this.stopped) return
    void this.connect().catch((err) => {
      if (!this.stopped) {
        this.handlers.onError(err instanceof Error ? err.message : 'Realtime connect failed')
      }
    })
  }

  /** Call after WhatsApp accept unmutes the send track so the greeting is heard. */
  enableGreeting() {
    this.greetWhenReady = true
    this.requestGreeting()
  }

  stop() {
    this.stopped = true
    try {
      this.dc?.close()
    } catch {
      // ignore
    }
    this.dc = null
    closePeer(this.pc, null)
    this.pc = null
    this.sender = null
    this.callerBridge?.stop()
    this.callerBridge = null
  }

  private wireCallerStream(stream: MediaStream) {
    this.callerBridge?.attach(stream)
    stream.onaddtrack = () => {
      if (!this.stopped) this.callerBridge?.attach(stream)
    }
    for (const track of stream.getAudioTracks()) {
      track.enabled = true
      track.addEventListener('unmute', () => {
        if (!this.stopped && this.remote) this.callerBridge?.attach(this.remote)
      })
    }
  }

  private async connect() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    this.pc = pc
    pc.addEventListener('track', (event) => {
      if (event.track.kind !== 'audio' || this.stopped) return
      const stream = event.streams[0] ?? new MediaStream([event.track])
      this.outbound.attachRealtime(stream)
    })

    const bridge = createCallerAudioBridge()
    this.callerBridge = bridge
    if (this.remote) this.wireCallerStream(this.remote)
    this.sender = pc.addTrack(bridge.track, new MediaStream([bridge.track]))

    const dc = pc.createDataChannel('oai-events')
    this.dc = dc
    dc.addEventListener('open', () => {
      this.requestGreeting()
    })
    dc.addEventListener('message', (event) => {
      this.onData(event.data)
    })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    // Do not cut ICE gathering short. A partial localDescription can leave
    // OpenAI's SDP parser at EOF, especially for Web Audio destination tracks.
    await waitForIceGathering(pc)
    if (this.stopped) return

    const sdp = pc.localDescription?.sdp
    if (!sdp) throw new Error('Missing Realtime SDP offer')

    const res = await fetch('/api/calling/live-ai/realtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: this.callId, sdp }),
    })
    const json = (await res.json().catch(() => ({}))) as { sdp?: string; error?: string }
    if (!res.ok || !json.sdp) {
      throw new Error(json.error || 'Realtime session failed')
    }
    const answerSdp = normalizeOfferSdp(json.sdp)
    if (!answerSdp) throw new Error('OpenAI returned an empty SDP answer')
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
  }

  private send(event: Record<string, unknown>) {
    if (this.dc?.readyState !== 'open') return
    this.dc.send(JSON.stringify(event))
  }

  private requestGreeting() {
    if (!this.greetWhenReady || this.greeted || this.stopped) return
    if (this.dc?.readyState !== 'open') return
    this.greeted = true
    this.send({ type: 'response.create' })
  }

  private onData(raw: unknown) {
    if (this.stopped) return
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(typeof raw === 'string' ? raw : String(raw ?? '')) as Record<
        string,
        unknown
      >
    } catch {
      return
    }
    const action = interpretRealtimeEvent(payload)
    if (action.type === 'ignore') return
    if (action.type === 'error') {
      this.handlers.onError(action.message)
      return
    }
    if (action.type === 'customer_transcript') {
      this.handlers.onTranscript('customer', action.text)
      void persistTranscript(this.callId, 'customer', action.text, action.itemId)
      return
    }
    if (action.type === 'bot_transcript') {
      if (action.text) {
        this.handlers.onTranscript('bot', action.text)
        void persistTranscript(this.callId, 'bot', action.text, action.itemId)
      }
      if (action.handoff) this.finishHandoff()
      return
    }
    if (action.type === 'function_calls') {
      void this.runTools(action.calls)
    }
  }

  private async runTools(calls: RealtimeFunctionCall[]) {
    for (const call of calls) {
      if (this.stopped) return
      try {
        const res = await fetch('/api/calling/live-ai/tool', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            callId: this.callId,
            name: call.name,
            arguments: call.arguments,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          output?: string
          handoff?: boolean
          error?: string
        }
        if (!res.ok) {
          this.send({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: call.callId,
              output: JSON.stringify({ error: json.error || 'Tool failed' }),
            },
          })
          continue
        }
        this.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: json.output || '{"ok":true}',
          },
        })
        if (json.handoff || call.name === TRANSFER_TO_HUMAN_TOOL) {
          this.finishHandoff()
          return
        }
      } catch (err) {
        this.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify({
              error: err instanceof Error ? err.message : 'Tool failed',
            }),
          },
        })
      }
    }
    if (!this.stopped) this.send({ type: 'response.create' })
  }

  private finishHandoff() {
    if (this.handoffSent || this.stopped) return
    this.handoffSent = true
    this.handlers.onHandoff()
    this.stop()
  }
}

async function persistTranscript(
  callId: string,
  role: 'customer' | 'bot',
  text: string,
  itemId?: string,
): Promise<void> {
  await fetch('/api/calling/live-ai/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'transcript', callId, role, text, itemId }),
  }).catch(() => {})
}

/** Compile Realtime + tool routes before an inbound call (dev cold compile is 50s+). */
export async function prefetchLiveAiRealtimeRoute(): Promise<void> {
  await Promise.all([
    fetch('/api/calling/live-ai/realtime').catch(() => {}),
    fetch('/api/calling/live-ai/tool').catch(() => {}),
    fetch('/api/calling/live-ai/warmup', { method: 'POST' }).catch(() => {}),
  ])
}
