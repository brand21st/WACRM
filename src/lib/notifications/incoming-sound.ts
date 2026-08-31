// Short two-tone chime for inbound WhatsApp messages. Generated with
// Web Audio so we don't ship a binary asset, and so the pitch stays
// consistent across devices.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** Call from a user gesture so later autoplay-blocked chimes can play. */
export function unlockIncomingSound(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume();
}

function ping(
  c: AudioContext,
  at: number,
  freq: number,
  dur: number,
  peak: number,
): void {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function playIncomingMessageSound(): void {
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === "suspended") void c.resume();
    const now = c.currentTime;
    ping(c, now, 880, 0.09, 0.16);
    ping(c, now + 0.11, 1174.7, 0.16, 0.2);
  } catch {
    // Autoplay policy / missing AudioContext — never break the inbox.
  }
}
