export type AudioOutputDevice = {
  deviceId: string
  kind: string
  label: string
}

const SPEAKER_RE = /speaker|loudspeaker|multimedia/
const EARPIECE_RE = /headphone|headset|earpiece|ear piece|communications|bluetooth/

function labelOf(device: AudioOutputDevice): string {
  return device.label.toLowerCase()
}

/** Empty string = browser default output. */
export function pickAudioOutputId(
  devices: AudioOutputDevice[],
  speakerOn: boolean,
): string {
  const outputs = devices.filter((d) => d.kind === 'audiooutput')
  if (outputs.length === 0) return ''

  if (speakerOn) {
    const speaker = outputs.find((d) => {
      const label = labelOf(d)
      return SPEAKER_RE.test(label) && !EARPIECE_RE.test(label)
    })
    return speaker?.deviceId ?? ''
  }

  const ear = outputs.find((d) => EARPIECE_RE.test(labelOf(d)))
  return ear?.deviceId ?? ''
}

/**
 * Plays remote WebRTC audio through the computer speakers.
 *
 * Chromium will not reliably emit WebRTC audio from a `display:none`
 * element, and `setSinkId` is a no-op on most desktops. Keep an
 * `<audio>` element playing (not muted) so the media pipeline stays
 * alive, and tap the stream with Web Audio into `AudioContext.destination`.
 */
export class RemoteCallAudio {
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private gain: GainNode | null = null
  private audioEl: HTMLAudioElement | null = null
  private stream: MediaStream | null = null
  private speakerOn = true

  /** Open/resume the audio context during a user gesture (Answer / Speaker). */
  async prime(): Promise<void> {
    if (typeof window === 'undefined') return
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new Ctor()
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
  }

  attach(
    stream: MediaStream,
    speakerOn: boolean,
    audioEl?: HTMLAudioElement | null,
  ): void {
    this.speakerOn = speakerOn
    if (audioEl) this.audioEl = audioEl
    const el = this.audioEl
    if (el) {
      for (const track of stream.getAudioTracks()) {
        track.enabled = true
      }
      el.srcObject = stream
      el.autoplay = true
      el.muted = false
      el.volume = 1
      void el.play().catch(() => {
        // Speaker click retries play().
      })
    }
    this.connectGraph(stream)
    this.applyGain()
  }

  setSpeaker(on: boolean): void {
    this.speakerOn = on
    if (on) void this.prime()
    this.applyGain()
    const el = this.audioEl
    if (el && on) void el.play().catch(() => {})
  }

  /** Cut speakers immediately without waiting for peer teardown. */
  silence(): void {
    this.speakerOn = false
    if (this.gain) {
      try {
        const ctx = this.ctx
        if (ctx && ctx.state === 'running') {
          const now = ctx.currentTime
          this.gain.gain.cancelScheduledValues(now)
          this.gain.gain.setValueAtTime(this.gain.gain.value, now)
          this.gain.gain.linearRampToValueAtTime(0, now + 0.03)
        } else {
          this.gain.gain.value = 0
        }
      } catch {
        this.gain.gain.value = 0
      }
    }
    const el = this.audioEl
    if (el) {
      el.volume = 0
      el.muted = true
      try {
        el.pause()
      } catch {
        // ignore
      }
    }
  }

  stop(): void {
    this.silence()
    if (this.ctx) this.ctx.onstatechange = null
    const el = this.audioEl
    if (el) {
      el.srcObject = null
    }
    this.disconnectGraph()
    this.stream = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx && ctx.state !== 'closed') {
      const close = () => {
        void ctx.close()
      }
      if (typeof window !== 'undefined') window.setTimeout(close, 50)
      else close()
    }
  }

  private connectGraph(stream: MediaStream): void {
    if (typeof window === 'undefined') return
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new Ctor()
    }
    if (this.source && this.stream === stream) {
      void this.ctx.resume().then(() => this.applyGain())
      return
    }
    if (this.source) {
      this.disconnectGraph()
      try {
        this.ctx.close()
      } catch {
        // already closed
      }
      this.ctx = new Ctor()
    }
    try {
      this.source = this.ctx.createMediaStreamSource(stream)
      this.gain = this.ctx.createGain()
      this.source.connect(this.gain)
      this.gain.connect(this.ctx.destination)
      this.stream = stream
    } catch {
      this.source = null
      this.gain = null
    }
    this.ctx.onstatechange = () => this.applyGain()
    void this.ctx.resume().then(() => this.applyGain())
  }

  private disconnectGraph(): void {
    try {
      this.source?.disconnect()
    } catch {
      // already disconnected
    }
    try {
      this.gain?.disconnect()
    } catch {
      // already disconnected
    }
    this.source = null
    this.gain = null
  }

  private applyGain(): void {
    if (this.ctx?.state === 'closed') return
    const on = this.speakerOn
    if (this.gain) this.gain.gain.value = on ? 1 : 0
    const el = this.audioEl
    if (!el) return
    if (!on) {
      el.volume = 0
      el.muted = true
      return
    }
    el.muted = false
    el.volume = 1
    void el.play().catch(() => {})
  }
}

export async function applySpeakerOutput(
  audioEl: HTMLAudioElement,
  speakerOn: boolean,
): Promise<void> {
  audioEl.muted = !speakerOn
  audioEl.volume = speakerOn ? 1 : 0
  if (speakerOn) {
    try {
      await audioEl.play()
    } catch {
      // Needs a user gesture; the speaker button click usually supplies it.
    }
  }
}
