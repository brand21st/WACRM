type MixHandle = {
  context: AudioContext
  dest: MediaStreamAudioDestinationNode
  recorder: MediaRecorder
  chunks: Blob[]
}

export class CallRecorder {
  private mix: MixHandle | null = null

  start(local: MediaStream, remote: MediaStream | null): void {
    this.stop()
    const context = new AudioContext()
    const dest = context.createMediaStreamDestination()
    const localNode = context.createMediaStreamSource(local)
    localNode.connect(dest)
    if (remote && remote.getAudioTracks().length > 0) {
      const remoteNode = context.createMediaStreamSource(remote)
      remoteNode.connect(dest)
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(dest.stream, { mimeType: mime })
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.start(1000)
    this.mix = { context, dest, recorder, chunks }
  }

  attachRemote(remote: MediaStream): void {
    if (!this.mix) return
    if (remote.getAudioTracks().length === 0) return
    const remoteNode = this.mix.context.createMediaStreamSource(remote)
    remoteNode.connect(this.mix.dest)
  }

  async stop(): Promise<Blob | null> {
    const mix = this.mix
    this.mix = null
    if (!mix) return null
    const blob = await new Promise<Blob | null>((resolve) => {
      mix.recorder.onstop = () => {
        const type = mix.recorder.mimeType?.split(';')[0]?.trim() || 'audio/webm'
        const out = mix.chunks.length ? new Blob(mix.chunks, { type }) : null
        resolve(out)
      }
      try {
        if (mix.recorder.state !== 'inactive') mix.recorder.stop()
        else resolve(mix.chunks.length ? new Blob(mix.chunks) : null)
      } catch {
        resolve(null)
      }
    })
    try {
      await mix.context.close()
    } catch {
      // already closed
    }
    return blob
  }
}

let consent: { ctx: AudioContext; osc: OscillatorNode } | null = null

export function stopConsentBeep(): void {
  const active = consent
  consent = null
  if (!active) return
  try {
    active.osc.stop()
  } catch {
    // already stopped
  }
  try {
    active.osc.disconnect()
  } catch {
    // already disconnected
  }
  if (active.ctx.state !== 'closed') void active.ctx.close()
}

export async function playConsentBeep(durationMs = 700): Promise<void> {
  stopConsentBeep()
  if (typeof AudioContext === 'undefined') return
  const context = new AudioContext()
  const osc = context.createOscillator()
  const gain = context.createGain()
  osc.frequency.value = 880
  gain.gain.value = 0.08
  osc.connect(gain)
  gain.connect(context.destination)
  osc.start()
  consent = { ctx: context, osc }
  await new Promise((resolve) => setTimeout(resolve, durationMs))
  if (consent?.ctx !== context) return
  stopConsentBeep()
}
