/**
 * Looping ringtone for inbound WhatsApp calls. Web Audio only — no
 * binary asset — matching `incoming-sound.ts`.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let timer: ReturnType<typeof setInterval> | null = null
let oscillators: OscillatorNode[] = []

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  return ctx
}

function getMaster(): GainNode | null {
  const c = getCtx()
  if (!c) return null
  if (!master) {
    master = c.createGain()
    master.gain.value = 1
    master.connect(c.destination)
  }
  return master
}

export function unlockCallSound(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') void c.resume()
}

function ping(c: AudioContext, dest: GainNode, at: number, freq: number, dur: number, peak: number) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain)
  gain.connect(dest)
  osc.start(at)
  osc.stop(at + dur + 0.02)
  oscillators.push(osc)
}

function ringOnce() {
  try {
    const c = getCtx()
    const dest = getMaster()
    if (!c || !dest) return
    if (c.state === 'suspended') void c.resume()
    dest.gain.value = 1
    const now = c.currentTime
    ping(c, dest, now, 440, 0.18, 0.12)
    ping(c, dest, now + 0.2, 554, 0.18, 0.12)
    ping(c, dest, now + 0.42, 440, 0.18, 0.12)
    ping(c, dest, now + 0.62, 554, 0.18, 0.12)
  } catch {
    // Autoplay policy — never break the dashboard.
  }
}

export function startCallRingtone(): void {
  stopCallRingtone()
  if (master) master.gain.value = 1
  ringOnce()
  timer = setInterval(ringOnce, 2000)
}

export function stopCallRingtone(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (master) master.gain.value = 0
  for (const osc of oscillators) {
    try {
      osc.stop()
    } catch {
      // already stopped
    }
    try {
      osc.disconnect()
    } catch {
      // already disconnected
    }
  }
  oscillators = []
}
