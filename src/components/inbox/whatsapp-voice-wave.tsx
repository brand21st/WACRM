"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  drawWhatsAppBars,
  WA_BAR_GAP,
  WA_BAR_WIDTH,
  WA_WAVE_BARS,
} from "@/lib/inbox/voice-waveform";

const BAR_STEP = WA_BAR_WIDTH + WA_BAR_GAP;
/** Live wave slides about one bar every 45ms — WhatsApp's scroll feel. */
const LIVE_PX_PER_MS = BAR_STEP / 45;

function fitCanvas(canvas: HTMLCanvasElement): { width: number; height: number; ctx: CanvasRenderingContext2D } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const pxW = Math.floor(width * dpr);
  const pxH = Math.floor(height * dpr);
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW;
    canvas.height = pxH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height, ctx };
}

function cssColor(el: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/** Static / playback waveform — same bars WhatsApp uses on a voice note. */
export function WhatsAppVoiceWave({
  peaks,
  progress = 0,
  getProgress,
  tracking = false,
  revision = 0,
  className,
}: {
  peaks: number[];
  progress?: number;
  /** When `tracking`, read progress every frame from the audio element. */
  getProgress?: () => number;
  tracking?: boolean;
  /** Bump after seek so a paused wave repaints. */
  revision?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const getProgressRef = useRef(getProgress);
  getProgressRef.current = getProgress;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0;
    let displayed = progressRef.current;

    const frame = () => {
      const target = getProgressRef.current?.() ?? progressRef.current;
      displayed += (target - displayed) * 0.28;

      const fitted = fitCanvas(canvas);
      if (fitted) {
        fitted.ctx.clearRect(0, 0, fitted.width, fitted.height);
        drawWhatsAppBars(fitted.ctx, {
          width: fitted.width,
          height: fitted.height,
          peaks: peaksRef.current,
          progress: displayed,
          color: cssColor(canvas, "--wave-bar", "rgba(0,0,0,0.38)"),
          playedColor: cssColor(canvas, "--wave-bar-played", "#f87171"),
          showPlayhead: displayed > 0.002 && displayed < 0.998,
        });
      }

      if (tracking || Math.abs(target - displayed) > 0.001) {
        raf = requestAnimationFrame(frame);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tracking, peaks, revision]);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "h-10 w-full [--wave-bar:rgba(0,0,0,0.42)] [--wave-bar-played:#f87171]",
        className,
      )}
      aria-hidden
    />
  );
}

/**
 * Live scrolling envelope while the mic is open. Same thin-bar language
 * as {@link WhatsAppVoiceWave} so record and playback match.
 */
export function LiveRecordWaveform({
  analyser,
  className,
}: {
  analyser: AnalyserNode;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const history = new Array<number>(WA_WAVE_BARS + 1).fill(0.12);
    const samples = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let last = performance.now();
    let scrollPx = 0;
    let smoothed = 0.12;

    const paint = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;

      try {
        analyser.getByteTimeDomainData(samples);
      } catch {
        return;
      }
      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const n = Math.abs((samples[i] - 128) / 128);
        if (n > peak) peak = n;
      }
      const target = Math.max(0.12, Math.min(1, peak * 1.85));
      smoothed += (target - smoothed) * Math.min(1, dt * 0.018);

      scrollPx += dt * LIVE_PX_PER_MS;
      while (scrollPx >= BAR_STEP) {
        history.shift();
        history.push(smoothed);
        scrollPx -= BAR_STEP;
      }
      history[history.length - 1] = smoothed;

      const fitted = fitCanvas(canvas);
      if (fitted) {
        fitted.ctx.clearRect(0, 0, fitted.width, fitted.height);
        const barColor = cssColor(canvas, "--wave-bar", "rgba(0,0,0,0.38)");
        drawWhatsAppBars(fitted.ctx, {
          width: fitted.width,
          height: fitted.height,
          peaks: history,
          progress: 1,
          color: barColor,
          playedColor: barColor,
          offsetX: scrollPx,
        });
      }
      raf = requestAnimationFrame(paint);
    };

    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        "h-10 w-full [--wave-bar:rgba(0,0,0,0.38)]",
        className,
      )}
      aria-hidden
    />
  );
}
