const MIN_VOICE_PEAK = 0.12
const VOICE_GAIN = 2.35

export function voicePeakFromTimeDomain(samples: Uint8Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const n = Math.abs((samples[i] - 128) / 128)
    if (n > peak) peak = n
  }
  return Math.max(MIN_VOICE_PEAK, Math.min(1, peak * VOICE_GAIN))
}

/** One bar per slice of the current audio frame — heights only, no scroll. */
export function voiceBarsFromTimeDomain(
  samples: Uint8Array,
  barCount: number,
): number[] {
  const count = Math.max(1, barCount)
  if (samples.length === 0) return new Array(count).fill(MIN_VOICE_PEAK)
  const bucket = Math.max(1, Math.floor(samples.length / count))
  const peaks = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    const start = i * bucket
    const end = i === count - 1 ? samples.length : Math.min(samples.length, start + bucket)
    let max = 0
    for (let j = start; j < end; j++) {
      const n = Math.abs((samples[j] - 128) / 128)
      if (n > max) max = n
    }
    peaks[i] = Math.max(MIN_VOICE_PEAK, Math.min(1, max * VOICE_GAIN))
  }
  return peaks
}

/**
 * Silent Web Audio tap for in-call waveforms. Own context so it never
 * fights RemoteCallAudio / CallRecorder (one MediaStreamSource per
 * stream per context). Not connected at audible gain.
 */

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  )
}

export class CallWaveAnalyser {
  private ctx: AudioContext | null = null
  private silent: GainNode | null = null
  private mix: GainNode | null = null
  private localGain: GainNode | null = null
  private localSource: MediaStreamAudioSourceNode | null = null
  private remoteSource: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private localStream: MediaStream | null = null
  private remoteStream: MediaStream | null = null

  get node(): AnalyserNode | null {
    return this.analyser
  }

  async prime(): Promise<void> {
    this.ensureGraph()
    if (this.ctx?.state === 'suspended') await this.ctx.resume()
  }

  attachLocal(stream: MediaStream, muted: boolean): void {
    this.ensureGraph()
    if (!this.ctx || !this.localGain) return
    if (this.localStream !== stream) {
      this.disconnectNode(this.localSource)
      this.localSource = null
      try {
        this.localSource = this.ctx.createMediaStreamSource(stream)
        this.localSource.connect(this.localGain)
        this.localStream = stream
      } catch {
        this.localSource = null
      }
    }
    this.setLocalMuted(muted)
  }

  attachRemote(stream: MediaStream): void {
    this.ensureGraph()
    if (!this.ctx || !this.mix) return
    if (this.remoteStream === stream) return
    this.disconnectNode(this.remoteSource)
    this.remoteSource = null
    try {
      this.remoteSource = this.ctx.createMediaStreamSource(stream)
      this.remoteSource.connect(this.mix)
      this.remoteStream = stream
    } catch {
      this.remoteSource = null
    }
  }

  setLocalMuted(muted: boolean): void {
    if (this.localGain) this.localGain.gain.value = muted ? 0 : 1
  }

  stop(): void {
    this.disconnectNode(this.localSource)
    this.disconnectNode(this.remoteSource)
    this.disconnectNode(this.localGain)
    this.disconnectNode(this.mix)
    this.disconnectNode(this.analyser)
    this.disconnectNode(this.silent)
    this.localSource = null
    this.remoteSource = null
    this.localGain = null
    this.mix = null
    this.analyser = null
    this.silent = null
    this.localStream = null
    this.remoteStream = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx && ctx.state !== 'closed') void ctx.close()
  }

  private ensureGraph(): void {
    const Ctor = audioContextCtor()
    if (!Ctor) return
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new Ctor()
      this.silent = null
      this.mix = null
      this.analyser = null
      this.localGain = null
      this.localSource = null
      this.remoteSource = null
      this.localStream = null
      this.remoteStream = null
    }
    if (this.silent && this.mix && this.analyser) return

    this.silent = this.ctx.createGain()
    this.silent.gain.value = 0
    this.silent.connect(this.ctx.destination)

    this.analyser = this.makeAnalyser()
    this.mix = this.ctx.createGain()
    this.mix.gain.value = 1
    this.localGain = this.ctx.createGain()
    this.localGain.gain.value = 1
    this.localGain.connect(this.mix)
    this.mix.connect(this.analyser)
    this.analyser.connect(this.silent)
  }

  private makeAnalyser(): AnalyserNode {
    const node = this.ctx!.createAnalyser()
    node.fftSize = 256
    node.smoothingTimeConstant = 0.35
    return node
  }

  private disconnectNode(node: AudioNode | null): void {
    try {
      node?.disconnect()
    } catch {
      // already disconnected
    }
  }
}
