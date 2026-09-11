const MIN_PEAK = 0.12;
const BAR_COUNT = 48;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic pseudo-envelope when we cannot decode the audio bytes. */
export function peaksFromUri(uri: string, bars = BAR_COUNT): number[] {
  let seed = hashString(uri);
  const peaks = new Array<number>(bars);
  for (let i = 0; i < bars; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const wave = 0.35 + 0.65 * Math.abs(Math.sin((i / bars) * Math.PI * 3 + seed * 0.00001));
    const noise = (seed % 1000) / 1000;
    peaks[i] = Math.max(MIN_PEAK, Math.min(1, wave * 0.55 + noise * 0.45));
  }
  return peaks;
}

export async function loadVoicePeaks(uri: string, bars = BAR_COUNT): Promise<number[]> {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return peaksFromUri(uri, bars);
  }

  try {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('peak fetch failed');
    const bytes = await response.arrayBuffer();
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(bytes.slice(0));
      const channel = audio.getChannelData(0);
      const bucket = Math.max(1, Math.floor(channel.length / bars));
      const peaks = new Array<number>(bars);
      let loudest = 0.0001;
      for (let i = 0; i < bars; i++) {
        const start = i * bucket;
        const end = i === bars - 1 ? channel.length : Math.min(channel.length, start + bucket);
        let max = 0;
        for (let j = start; j < end; j++) {
          const value = Math.abs(channel[j] ?? 0);
          if (value > max) max = value;
        }
        peaks[i] = max;
        if (max > loudest) loudest = max;
      }
      return peaks.map((peak) => Math.max(MIN_PEAK, peak / loudest));
    } finally {
      void ctx.close().catch(() => {});
    }
  } catch {
    return peaksFromUri(uri, bars);
  }
}
