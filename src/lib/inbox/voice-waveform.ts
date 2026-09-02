/** Shared WhatsApp-style voice-note waveform helpers. */

export const WA_WAVE_BARS = 80;
/** Fixed bar + gap, like WhatsApp — do not stretch to fill. */
export const WA_BAR_WIDTH = 2;
export const WA_BAR_GAP = 2;
const WA_MIN_PEAK = 0.12;

const peakCache = new Map<string, number[]>();
const peakInflight = new Map<string, Promise<number[]>>();

/** Downsample one channel into WhatsApp-like peak bars (0–1). */
export function peaksFromChannel(channel: Float32Array, bars = WA_WAVE_BARS): number[] {
  const len = channel.length;
  if (len === 0) return new Array(bars).fill(WA_MIN_PEAK);
  const bucket = Math.max(1, Math.floor(len / bars));
  const peaks = new Array<number>(bars);
  let loudest = 0.0001;
  for (let i = 0; i < bars; i++) {
    const start = i * bucket;
    const end = i === bars - 1 ? len : Math.min(len, start + bucket);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(channel[j] ?? 0);
      if (v > max) max = v;
    }
    peaks[i] = max;
    if (max > loudest) loudest = max;
  }
  return peaks.map((p) => Math.max(WA_MIN_PEAK, p / loudest));
}

export function resamplePeaks(peaks: number[], count: number): number[] {
  if (count <= 0) return [];
  if (peaks.length === count) return peaks;
  const out = new Array<number>(count);
  const last = Math.max(peaks.length - 1, 0);
  for (let i = 0; i < count; i++) {
    const src = peaks.length === 0 ? 0 : (i / count) * peaks.length;
    out[i] = peaks[Math.min(last, Math.floor(src))] ?? WA_MIN_PEAK;
  }
  return out;
}

export function barsThatFit(width: number): number {
  return Math.max(24, Math.floor((width + WA_BAR_GAP) / (WA_BAR_WIDTH + WA_BAR_GAP)));
}

/**
 * Decode a voice-note URL into cached peak bars. Falls back to a quiet
 * envelope when fetch/decode fails (CORS, expired inbound media).
 */
export function loadVoicePeaks(url: string, bars = WA_WAVE_BARS): Promise<number[]> {
  const cached = peakCache.get(url);
  if (cached) return Promise.resolve(cached);
  const pending = peakInflight.get(url);
  if (pending) return pending;

  const work = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("peak fetch failed");
      const bytes = await res.arrayBuffer();
      const ctx = new AudioContext();
      try {
        const audio = await ctx.decodeAudioData(bytes.slice(0));
        const peaks = peaksFromChannel(audio.getChannelData(0), bars);
        peakCache.set(url, peaks);
        return peaks;
      } finally {
        void ctx.close().catch(() => {});
      }
    } catch {
      const fallback = new Array(bars).fill(WA_MIN_PEAK);
      peakCache.set(url, fallback);
      return fallback;
    } finally {
      peakInflight.delete(url);
    }
  })();

  peakInflight.set(url, work);
  return work;
}

function fillRoundBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const r = Math.min(w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.fill();
}

function paintBarRow(
  ctx: CanvasRenderingContext2D,
  peaks: number[],
  mid: number,
  height: number,
  offsetX: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  for (let i = 0; i < peaks.length; i++) {
    const x = i * (WA_BAR_WIDTH + WA_BAR_GAP) - offsetX;
    const h = Math.max(WA_BAR_WIDTH, peaks[i] * height * 0.94);
    fillRoundBar(ctx, x, mid - h / 2, WA_BAR_WIDTH, h);
  }
}

export function drawWhatsAppBars(
  ctx: CanvasRenderingContext2D,
  args: {
    width: number;
    height: number;
    peaks: number[];
    progress?: number;
    color: string;
    playedColor?: string;
    showPlayhead?: boolean;
    /** Sub-bar scroll (px) so the live wave slides instead of jumping. */
    offsetX?: number;
  },
): void {
  const { width, height, color } = args;
  const progress = Math.min(1, Math.max(0, args.progress ?? 1));
  const playedColor = args.playedColor ?? color;
  const showPlayhead = args.showPlayhead === true;
  const offsetX = args.offsetX ?? 0;
  const count = barsThatFit(width) + (offsetX > 0 ? 1 : 0);
  const peaks = resamplePeaks(args.peaks, count);
  const mid = height / 2;
  const playedUntil = progress * width;

  paintBarRow(ctx, peaks, mid, height, offsetX, color);
  if (progress > 0 && playedColor !== color) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playedUntil, height);
    ctx.clip();
    paintBarRow(ctx, peaks, mid, height, offsetX, playedColor);
    ctx.restore();
  }

  if (showPlayhead && progress > 0 && progress < 1) {
    ctx.fillStyle = playedColor;
    ctx.beginPath();
    ctx.arc(playedUntil, mid, 3.25, 0, Math.PI * 2);
    ctx.fill();
  }
}
