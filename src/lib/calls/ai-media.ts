export type AiOutbound = {
  stream: MediaStream
  setTrackEnabled: (enabled: boolean) => void
  playMp3: (bytes: ArrayBuffer) => Promise<void>
  /** Pipe OpenAI Realtime remote audio into the WhatsApp send track. */
  attachRealtime: (stream: MediaStream) => void
  stopPlayback: () => void
  stop: () => void
}

let primedAiContext: AudioContext | null = null

/**
 * Create/resume the shared AI AudioContext during a user gesture
 * (Start station). Auto-answer later cannot unlock a fresh context.
 */
export async function primeAiAudio(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!primedAiContext || primedAiContext.state === 'closed') {
    primedAiContext = new AudioContext()
  }
  if (primedAiContext.state === 'suspended') {
    await primedAiContext.resume().catch(() => {})
  }
}

export type CallerAudioBridge = {
  track: MediaStreamTrack
  attach: (stream: MediaStream) => void
  stop: () => void
}

/**
 * Forward WhatsApp remote audio into a local track for the OpenAI peer.
 * Chrome cannot reliably replaceTrack() a receive-only WebRTC track onto
 * a second peer connection, so this goes through Web Audio.
 */
export function createCallerAudioBridge(): CallerAudioBridge {
  const context = primedAiContext
  if (!context || context.state === 'closed') {
    throw new Error('AI audio context unavailable')
  }
  const destination = context.createMediaStreamDestination()
  const keepAlive = context.createGain()
  keepAlive.gain.value = 0.0001
  const osc = context.createOscillator()
  osc.connect(keepAlive)
  keepAlive.connect(destination)
  osc.start()

  let source: MediaStreamAudioSourceNode | null = null
  let speechGain: GainNode | null = null
  let tap: GainNode | null = null
  const track = destination.stream.getAudioTracks()[0]
  if (!track) throw new Error('AI audio context unavailable')
  if ('contentHint' in track) track.contentHint = 'speech'

  const disconnectSource = () => {
    try {
      source?.disconnect()
    } catch {
      // already disconnected
    }
    try {
      speechGain?.disconnect()
    } catch {
      // already disconnected
    }
    try {
      tap?.disconnect()
    } catch {
      // already disconnected
    }
    source = null
    speechGain = null
    tap = null
  }

  return {
    track,
    attach(stream) {
      disconnectSource()
      const live = stream.getAudioTracks().filter((t) => t.readyState !== 'ended')
      if (live.length === 0) return
      for (const t of live) t.enabled = true
      if (context.state === 'suspended') {
        void context.resume().catch(() => {})
      }
      source = context.createMediaStreamSource(new MediaStream(live))
      speechGain = context.createGain()
      speechGain.gain.value = 1.25
      tap = context.createGain()
      tap.gain.value = 0.0001
      source.connect(speechGain)
      speechGain.connect(destination)
      // Keep Chrome rendering this graph even when the call <audio> is muted.
      speechGain.connect(tap)
      tap.connect(context.destination)
    },
    stop() {
      disconnectSource()
      try {
        osc.stop()
      } catch {
        // already stopped
      }
      try {
        osc.disconnect()
        keepAlive.disconnect()
      } catch {
        // already disconnected
      }
      destination.stream.getTracks().forEach((t) => t.stop())
    },
  }
}

/**
 * Near-silent track for the OpenAI peer until WhatsApp remote audio
 * arrives. Uses the primed context so auto-answer still works.
 */
export function createSilentPlaceholderTrack(): MediaStreamTrack {
  const context = primedAiContext
  if (!context || context.state === 'closed') {
    throw new Error('AI audio context unavailable')
  }
  const destination = context.createMediaStreamDestination()
  const osc = context.createOscillator()
  const gain = context.createGain()
  gain.gain.value = 0.0001
  osc.connect(gain)
  gain.connect(destination)
  osc.start()
  const track = destination.stream.getAudioTracks()[0]
  if (!track) throw new Error('AI audio context unavailable')
  track.addEventListener('ended', () => {
    try {
      osc.stop()
    } catch {
      // already stopped
    }
    try {
      osc.disconnect()
      gain.disconnect()
    } catch {
      // already disconnected
    }
  })
  return track
}

/**
 * Synthetic outbound WebRTC audio: comfort noise plus decoded TTS.
 * Does not use the microphone.
 */
export async function createAiOutbound(): Promise<AiOutbound> {
  await primeAiAudio()
  const context = primedAiContext
  if (!context || context.state === 'closed') {
    throw new Error('AI audio context unavailable')
  }
  const destination = context.createMediaStreamDestination()
  const master = context.createGain()
  master.gain.value = 1
  master.connect(destination)
  // Chrome may not render a destination-only graph. A near-silent tap
  // on the speakers keeps the context pulling samples into the track.
  const speakerTap = context.createGain()
  speakerTap.gain.value = 0.0001
  master.connect(speakerTap)
  speakerTap.connect(context.destination)

  const noiseGain = context.createGain()
  noiseGain.gain.value = 0.04
  const osc = context.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 180
  osc.connect(noiseGain)
  noiseGain.connect(master)
  osc.start()

  const stream = destination.stream
  for (const track of stream.getAudioTracks()) {
    track.enabled = false
    if ('contentHint' in track) {
      track.contentHint = 'speech'
    }
  }

  let playing: AudioBufferSourceNode | null = null
  let realtimeSource: MediaStreamAudioSourceNode | null = null

  return {
    stream,
    setTrackEnabled(enabled) {
      for (const track of stream.getAudioTracks()) {
        track.enabled = enabled
      }
    },
    attachRealtime(remote) {
      try {
        realtimeSource?.disconnect()
      } catch {
        // already disconnected
      }
      if (context.state === 'suspended') {
        void context.resume().catch(() => {})
      }
      const source = context.createMediaStreamSource(remote)
      source.connect(master)
      realtimeSource = source
      // Keep a whisper of tone so Chrome still renders the graph if
      // OpenAI is silent between turns.
      noiseGain.gain.value = 0.008
    },
    async playMp3(bytes) {
      if (context.state === 'suspended') {
        await context.resume().catch(() => {})
      }
      const copy = bytes.slice(0)
      const audioBuf = await context.decodeAudioData(copy)
      try {
        playing?.stop()
      } catch {
        // already stopped
      }
      const src = context.createBufferSource()
      src.buffer = audioBuf
      const ttsGain = context.createGain()
      ttsGain.gain.value = 1.4
      src.connect(ttsGain)
      ttsGain.connect(master)
      playing = src
      await new Promise<void>((resolve, reject) => {
        src.onended = () => {
          if (playing === src) playing = null
          resolve()
        }
        try {
          src.start()
        } catch (err) {
          reject(err)
        }
      })
    },
    stopPlayback() {
      try {
        playing?.stop()
      } catch {
        // already stopped
      }
      playing = null
    },
    stop() {
      try {
        osc.stop()
      } catch {
        // already stopped
      }
      try {
        playing?.stop()
      } catch {
        // already stopped
      }
      playing = null
      try {
        realtimeSource?.disconnect()
      } catch {
        // already disconnected
      }
      realtimeSource = null
      try {
        osc.disconnect()
        noiseGain.disconnect()
        master.disconnect()
        speakerTap.disconnect()
      } catch {
        // already disconnected
      }
      stream.getTracks().forEach((t) => t.stop())
      // Keep primedAiContext running so the next inbound call can speak
      // without another user gesture.
    },
  }
}

function rmsFromAnalyser(analyser: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128
    sum += v * v
  }
  return Math.sqrt(sum / buf.length)
}

/**
 * Wait for speech on `remote`, record until ~700ms silence or 12s max.
 * Returns null if aborted or the clip is too short.
 */
export async function captureUtterance(
  remote: MediaStream,
  opts: {
    signal?: AbortSignal
    isBlocked?: () => boolean
    silenceMs?: number
    maxMs?: number
    threshold?: number
  } = {},
): Promise<Blob | null> {
  const silenceMs = opts.silenceMs ?? 700
  const maxMs = opts.maxMs ?? 12_000
  const threshold = opts.threshold ?? 0.04
  const context = new AudioContext()
  if (context.state === 'suspended') {
    await context.resume().catch(() => {})
  }
  const source = context.createMediaStreamSource(remote)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const buf = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>

  const aborted = () => Boolean(opts.signal?.aborted)

  try {
    while (!aborted()) {
      if (opts.isBlocked?.()) {
        await sleep(80)
        continue
      }
      if (rmsFromAnalyser(analyser, buf) >= threshold) break
      await sleep(50)
    }
    if (aborted()) return null

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(remote, { mimeType: mime })
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data)
    }
    recorder.start(200)

    const started = Date.now()
    let silentSince: number | null = null
    while (!aborted()) {
      await sleep(50)
      const loud = rmsFromAnalyser(analyser, buf) >= threshold
      if (loud) silentSince = null
      else if (silentSince == null) silentSince = Date.now()
      const elapsed = Date.now() - started
      if (elapsed >= maxMs) break
      if (silentSince != null && Date.now() - silentSince >= silenceMs) break
    }

    const blob = await stopRecorder(recorder, chunks)
    if (aborted() || !blob || blob.size < 800) return null
    return blob
  } finally {
    try {
      source.disconnect()
    } catch {
      // ignore
    }
    void context.close()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stopRecorder(recorder: MediaRecorder, chunks: BlobPart[]): Promise<Blob | null> {
  return new Promise((resolve) => {
    recorder.onstop = () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
    }
    try {
      if (recorder.state === 'inactive') {
        resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }) : null)
        return
      }
      recorder.stop()
    } catch {
      resolve(null)
    }
  })
}
