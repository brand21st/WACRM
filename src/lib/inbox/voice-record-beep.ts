/** WhatsApp-style record start/stop ticks.

 * Must be called in the same user-gesture turn as the click. Playing through
 * the mic AudioContext after getUserMedia / encoder import is blocked by
 * autoplay policy, and closing that context cuts the stop tone. */

const SAMPLE_RATE = 44100;

/** Keep the element alive so GC cannot mute mid-play. */
let activeBeep: HTMLAudioElement | null = null;

export function buildRecordBeepWav(kind: "start" | "stop"): Blob {
  return new Blob([buildRecordBeepBytes(kind)], { type: "audio/wav" });
}

const START_BEEP_SRC = wavBytesToDataUri(buildRecordBeepBytes("start"));
const STOP_BEEP_SRC = wavBytesToDataUri(buildRecordBeepBytes("stop"));

export function playRecordBeep(kind: "start" | "stop"): void {
  const cueCtx =
    typeof AudioContext !== "undefined" ? new AudioContext() : null;
  if (cueCtx?.state === "suspended") {
    void cueCtx.resume().catch(() => {});
  }

  if (typeof Audio !== "undefined" && typeof document !== "undefined") {
    const audio = new Audio(kind === "start" ? START_BEEP_SRC : STOP_BEEP_SRC);
    audio.preload = "auto";
    audio.volume = 1;
    audio.setAttribute("playsinline", "");
    audio.style.display = "none";
    document.body.appendChild(audio);
    activeBeep = audio;
    const cleanup = () => {
      audio.remove();
      if (activeBeep === audio) activeBeep = null;
    };
    audio.addEventListener("ended", cleanup);
    audio.addEventListener("error", cleanup);
    const played = audio.play();
    if (played && typeof played.then === "function") {
      void played
        .then(() => {
          void cueCtx?.close().catch(() => {});
        })
        .catch(() => {
          cleanup();
          playOscillatorCue(cueCtx, kind);
        });
      return;
    }
  }
  playOscillatorCue(cueCtx, kind);
}

function playOscillatorCue(ctx: AudioContext | null, kind: "start" | "stop"): void {
  if (!ctx || ctx.state === "closed") return;
  const run = () => {
    if (ctx.state !== "running") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = kind === "start" ? 1760 : 1175;
    const now = ctx.currentTime;
    const dur = kind === "start" ? 0.13 : 0.17;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  };
  if (ctx.state === "running") {
    run();
    return;
  }
  void ctx.resume().then(run).catch(() => {});
}

function buildRecordBeepBytes(kind: "start" | "stop"): ArrayBuffer {
  const freq = kind === "start" ? 1760 : 1175;
  const durationMs = kind === "start" ? 130 : 170;
  const samples = Math.floor((SAMPLE_RATE * durationMs) / 1000);
  const pcm = new Int16Array(samples);
  const attack = Math.floor(SAMPLE_RATE * 0.008);
  const release = Math.floor(SAMPLE_RATE * 0.03);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const fadeIn = Math.min(1, i / attack);
    const fadeOut = Math.min(1, (samples - 1 - i) / release);
    const env = fadeIn * fadeOut;
    pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * env * 0.55 * 32767);
  }
  return pcm16ToWavBytes(pcm, SAMPLE_RATE);
}

function pcm16ToWavBytes(pcm: Int16Array, sampleRate: number): ArrayBuffer {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(44 + i * 2, pcm[i] ?? 0, true);
  }
  return buffer;
}

function wavBytesToDataUri(bytes: ArrayBuffer): string {
  const raw = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < raw.length; i++) {
    binary += String.fromCharCode(raw[i] ?? 0);
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
