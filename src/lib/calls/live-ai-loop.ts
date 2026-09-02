import { captureUtterance, type AiOutbound } from './ai-media'

export type LiveAiTurnResponse = {
  skipped?: boolean
  transcript: string
  reply: string
  audioBase64: string | null
  mimeType: string | null
  handoff: boolean
}

export type CachedGreeting = {
  reply: string
  audioBase64: string
}

export type LiveAiLoopHandlers = {
  onTranscript: (role: 'customer' | 'bot', text: string) => void
  onHandoff: () => void
  onError: (message: string) => void
}

export async function prefetchLiveAiTurnRoute(): Promise<void> {
  const form = new FormData()
  form.append('callId', 'warmup')
  form.append('kind', 'greeting')
  await fetch('/api/calling/live-ai/turn', { method: 'POST', body: form }).catch(() => {})
}

export async function loadCachedGreeting(): Promise<CachedGreeting | null> {
  const res = await fetch('/api/calling/live-ai/warmup', { method: 'POST' })
  const json = (await res.json().catch(() => ({}))) as CachedGreeting & { error?: string }
  if (!res.ok || !json.audioBase64 || !json.reply) return null
  return { reply: json.reply, audioBase64: json.audioBase64 }
}

function decodeBase64Audio(audioBase64: string): ArrayBuffer {
  const binary = atob(audioBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export class LiveAiLoop {
  private stopped = false
  private speaking = false
  private abort: AbortController | null = null
  private run: Promise<void> | null = null
  private remote: MediaStream | null
  private greetingFetch: Promise<LiveAiTurnResponse & { error?: string; ok: boolean }> | null

  constructor(
    private readonly callId: string,
    private readonly outbound: AiOutbound,
    remote: MediaStream | null,
    private readonly handlers: LiveAiLoopHandlers,
    private readonly cachedGreeting: CachedGreeting | null = null,
    greetingFetch?: Promise<LiveAiTurnResponse & { error?: string; ok: boolean }> | null,
  ) {
    this.remote = remote
    this.greetingFetch = greetingFetch ?? null
  }

  setRemote(stream: MediaStream) {
    this.remote = stream
  }

  start() {
    if (this.run) return
    this.abort = new AbortController()
    this.run = this.loop()
  }

  halt() {
    this.stopped = true
    this.abort?.abort()
    this.abort = null
  }

  async stop() {
    this.halt()
    try {
      await this.run
    } catch {
      // ignore
    }
    this.run = null
    this.outbound.stop()
  }

  private async loop() {
    if (this.cachedGreeting?.audioBase64) {
      this.handlers.onTranscript('bot', this.cachedGreeting.reply)
      try {
        await this.outbound.playMp3(decodeBase64Audio(this.cachedGreeting.audioBase64))
      } catch (err) {
        this.handlers.onError(err instanceof Error ? err.message : 'Greeting playback failed')
      }
      void this.persistPlayedGreeting(this.cachedGreeting.reply)
    } else if (this.greetingFetch) {
      await this.consumeTurn(await this.greetingFetch)
    } else {
      await this.runTurn('greeting')
    }
    let heardRemote = false
    const waitUntil = Date.now() + 8000
    while (!this.stopped) {
      const remote = this.remote
      if (!remote?.getAudioTracks().some((track) => track.readyState === 'live')) {
        if (!heardRemote && Date.now() > waitUntil) {
          this.handlers.onError('No caller audio')
          return
        }
        await sleep(100)
        continue
      }
      heardRemote = true
      const blob = await captureUtterance(remote, {
        signal: this.abort?.signal,
        isBlocked: () => this.speaking || this.stopped,
      })
      if (this.stopped) return
      if (!blob) continue
      await this.runTurn('utterance', blob)
    }
  }

  private async persistPlayedGreeting(reply: string) {
    const form = new FormData()
    form.append('callId', this.callId)
    form.append('kind', 'greeting')
    form.append('persistOnly', '1')
    form.append('reply', reply)
    await fetch('/api/calling/live-ai/turn', { method: 'POST', body: form }).catch(() => {})
  }

  private async runTurn(kind: 'greeting' | 'utterance', blob?: Blob) {
    if (this.stopped) return
    this.speaking = true
    try {
      const form = new FormData()
      form.append('callId', this.callId)
      form.append('kind', kind)
      if (blob) form.append('file', blob, 'utterance.webm')
      const res = await fetch('/api/calling/live-ai/turn', {
        method: 'POST',
        body: form,
        signal: this.abort?.signal,
      })
      const json = (await res.json().catch(() => ({}))) as LiveAiTurnResponse & {
        error?: string
      }
      await this.consumeTurn({ ...json, ok: res.ok })
    } catch (err) {
      if (!this.stopped) {
        this.handlers.onError(err instanceof Error ? err.message : 'Live AI turn failed')
      }
    } finally {
      this.speaking = false
    }
  }

  private async consumeTurn(json: LiveAiTurnResponse & { error?: string; ok?: boolean }) {
    if (this.stopped) return
    this.speaking = true
    try {
      if (json.ok === false) {
        this.handlers.onError(json.error || 'Live AI turn failed')
        return
      }
      if (json.skipped) return
      if (json.transcript) this.handlers.onTranscript('customer', json.transcript)
      if (json.reply) this.handlers.onTranscript('bot', json.reply)
      if (json.audioBase64) {
        await this.outbound.playMp3(decodeBase64Audio(json.audioBase64))
      }
      if (json.handoff) {
        this.handlers.onHandoff()
        this.stopped = true
      }
    } catch (err) {
      if (!this.stopped) {
        this.handlers.onError(err instanceof Error ? err.message : 'Live AI turn failed')
      }
    } finally {
      this.speaking = false
    }
  }
}

export function startGreetingTurn(
  callId: string,
): Promise<LiveAiTurnResponse & { error?: string; ok: boolean }> {
  const form = new FormData()
  form.append('callId', callId)
  form.append('kind', 'greeting')
  return fetch('/api/calling/live-ai/turn', { method: 'POST', body: form })
    .then(async (res) => {
      const json = (await res.json().catch(() => ({}))) as LiveAiTurnResponse & {
        error?: string
      }
      return { ...json, ok: res.ok }
    })
    .catch((err: unknown) => ({
      skipped: true,
      transcript: '',
      reply: '',
      audioBase64: null,
      mimeType: null,
      handoff: false,
      ok: false,
      error: err instanceof Error ? err.message : 'Live AI turn failed',
    }))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
