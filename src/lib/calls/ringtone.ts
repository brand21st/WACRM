/**
 * Looping ringtone for inbound WhatsApp calls. Web Audio only — no
 * binary asset — matching `incoming-sound.ts`.
 */

let ctx: AudioContext | null = null
let timer: ReturnType<typeof setInterval> | null = null

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

export function unlockCallSound(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') void c.resume()
}

function ping(c: AudioContext, at: number, freq: number, dur: number, peak: number) {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, at)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(at)
  osc.stop(at + dur + 0.02)
}

function ringOnce() {
  try {
    const c = getCtx()
    if (!c) return
    if (c.state === 'suspended') void c.resume()
    const now = c.currentTime
    ping(c, now, 440, 0.18, 0.12)
    ping(c, now + 0.2, 554, 0.18, 0.12)
    ping(c, now + 0.42, 440, 0.18, 0.12)
    ping(c, now + 0.62, 554, 0.18, 0.12)
  } catch {
    // Autoplay policy — never break the dashboard.
  }
}

export function startCallRingtone(): void {
  stopCallRingtone()
  ringOnce()
  timer = setInterval(ringOnce, 2000)
}

export function stopCallRingtone(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
