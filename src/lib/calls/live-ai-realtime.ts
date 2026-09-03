import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import { TRANSFER_TO_HUMAN_TOOL } from '@/lib/calling/live-ai-constants'
import {
  languageLockSessionEventsFromPersist,
  type LiveAiLanguagePersistPayload,
} from '@/lib/calling/live-ai-language-session'
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
  | { type: 'barge_in' }
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

function textFromRealtimeOutput(output: unknown): string {
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const rec = part as { transcript?: unknown; text?: unknown }
      if (typeof rec.transcript === 'string') parts.push(rec.transcript)
      else if (typeof rec.text === 'string') parts.push(rec.text)
    }
  }
  return parts.join('').trim()
}

function botTranscriptAction(
  raw: string,
  itemId?: string,
): RealtimeEventAction {
  const parsed = parseSpoken(raw)
  return {
    type: 'bot_transcript',
    text: parsed.text || raw,
    itemId,
    handoff: parsed.handoff,
  }
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

  if (type === 'input_audio_buffer.speech_started') {
    return { type: 'barge_in' }
  }

  if (
    type === 'response.output_audio_transcript.done' ||
    type === 'response.audio_transcript.done' ||
    type === 'response.output_text.done' ||
    type === 'response.text.done'
  ) {
    const text =
      typeof payload.transcript === 'string'
        ? payload.transcript.trim()
        : typeof payload.text === 'string'
          ? payload.text.trim()
          : ''
    if (!text) return { type: 'ignore' }
    return botTranscriptAction(
      text,
      typeof payload.item_id === 'string' ? payload.item_id : undefined,
    )
  }

  if (type === 'response.done') {
    const response = (payload.response ?? {}) as { output?: unknown }
    const calls = functionCallsFromOutput(response.output)
    if (calls.length > 0) return { type: 'function_calls', calls }
    const text = textFromRealtimeOutput(response.output)
    if (text) return botTranscriptAction(text)
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
  private ttsVoice = false
  private lastBotText = ''
  private pendingSpeak: { text: string; handoff: boolean } | null = null
  private speakBusy = false
  private handoffAfterSpeak = false

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
    this.pendingSpeak = null
    this.outbound.stopPlayback()
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
      if (event.track.kind !== 'audio' || this.stopped || this.ttsVoice) return
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
    const json = (await res.json().catch(() => ({}))) as {
      sdp?: string
      ttsVoice?: boolean
      error?: string
    }
    if (!res.ok || !json.sdp) {
      throw new Error(json.error || 'Realtime session failed')
    }
    this.ttsVoice = Boolean(json.ttsVoice)
    const answerSdp = normalizeOfferSdp(json.sdp)
    if (!answerSdp) throw new Error('OpenAI returned an empty SDP answer')
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
  }

  private send(event: Record<string, unknown>) {
    if (this.dc?.readyState !== 'open') return
    this.dc.send(JSON.stringify(event))
  }

  private async persistCustomerTranscript(text: string, itemId?: string) {
    const result = await persistTranscript(this.callId, 'customer', text, itemId)
    if (this.stopped) return
    for (const event of languageLockSessionEventsFromPersist(result)) {
      this.send(event)
    }
  }

  private requestGreeting() {
    if (!this.greetWhenReady || this.greeted || this.stopped) return
    if (this.dc?.readyState !== 'open') return
    this.greeted = true
    this.sendResponseCreate()
  }

  private sendResponseCreate() {
    this.send(
      this.ttsVoice
        ? { type: 'response.create', response: { output_modalities: ['text'] } }
        : { type: 'response.create' },
    )
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
    if (action.type === 'barge_in') {
      // Cut speaker audio only. Do not drop in-flight ElevenLabs fetches —
      // v3 takes several seconds, and VAD/false barge-in was discarding
      // finished speech so the caller heard silence.
      this.outbound.stopPlayback()
      return
    }
    if (action.type === 'error') {
      this.handlers.onError(action.message)
      return
    }
    if (action.type === 'customer_transcript') {
      this.handlers.onTranscript('customer', action.text)
      void this.persistCustomerTranscript(action.text, action.itemId)
      return
    }
    if (action.type === 'bot_transcript') {
      const isNew = Boolean(action.text && action.text !== this.lastBotText)
      if (isNew) {
        this.lastBotText = action.text
        this.handlers.onTranscript('bot', action.text)
        void persistTranscript(this.callId, 'bot', action.text, action.itemId)
        if (this.ttsVoice) {
          this.enqueueSpeak(action.text, action.handoff)
          return
        }
      } else if (this.ttsVoice && action.handoff) {
        this.handoffAfterSpeak = true
        if (!this.speakBusy) this.finishHandoff()
        return
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
    if (!this.stopped) this.sendResponseCreate()
  }

  private enqueueSpeak(text: string, handoff: boolean) {
    this.pendingSpeak = { text, handoff }
    void this.drainSpeak()
  }

  private async drainSpeak() {
    if (this.speakBusy) return
    this.speakBusy = true
    try {
      while (this.pendingSpeak && !this.stopped) {
        const next = this.pendingSpeak
        this.pendingSpeak = null
        const res = await fetch('/api/calling/live-ai/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId: this.callId, text: next.text }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          audioBase64?: string
          error?: string
        }
        if (this.stopped) return
        if (!res.ok || !json.audioBase64) {
          if (json.error) this.handlers.onError(json.error)
          if (next.handoff || this.handoffAfterSpeak) this.finishHandoff()
          continue
        }
        const binary = atob(json.audioBase64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        await this.outbound.playMp3(bytes.buffer)
        if (this.stopped) return
        if (next.handoff || this.handoffAfterSpeak) this.finishHandoff()
      }
    } catch (err) {
      if (!this.stopped) {
        this.handlers.onError(err instanceof Error ? err.message : 'Voice playback failed')
      }
    } finally {
      this.speakBusy = false
      if (this.pendingSpeak && !this.stopped) void this.drainSpeak()
    }
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
): Promise<LiveAiLanguagePersistPayload | null> {
  try {
    const res = await fetch('/api/calling/live-ai/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'transcript', callId, role, text, itemId }),
    })
    if (!res.ok) return null
    return (await res.json().catch(() => null)) as LiveAiLanguagePersistPayload | null
  } catch {
    return null
  }
}

/** Compile Realtime + tool routes before an inbound call (dev cold compile is 50s+). */
export async function prefetchLiveAiRealtimeRoute(): Promise<void> {
  await Promise.all([
    fetch('/api/calling/live-ai/realtime').catch(() => {}),
    fetch('/api/calling/live-ai/tool').catch(() => {}),
    fetch('/api/calling/live-ai/speak').catch(() => {}),
    fetch('/api/calling/live-ai/warmup', { method: 'POST' }).catch(() => {}),
  ])
}
