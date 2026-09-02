"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadVoicePeaks, WA_WAVE_BARS } from "@/lib/inbox/voice-waveform";
import { WhatsAppVoiceWave } from "./whatsapp-voice-wave";

function formatVoiceClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * WhatsApp-native voice-note player: play button, real envelope bars,
 * playhead, duration, mic glyph. Shared by the thread bubble and the
 * composer preview so record → preview → sent stay one look.
 */
export function VoiceNotePlayer({
  src,
  playLabel,
  pauseLabel,
  variant = "outbound",
  className,
}: {
  src: string;
  playLabel: string;
  pauseLabel: string;
  /** `preview` is the light composer card; outbound is the green bubble. */
  variant?: "outbound" | "inbound" | "preview";
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState(0);
  const [peaks, setPeaks] = useState<number[]>(() =>
    new Array(WA_WAVE_BARS).fill(0.12),
  );

  useEffect(() => {
    let cancelled = false;
    void loadVoicePeaks(src).then((next) => {
      if (!cancelled) setPeaks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const writeClock = (seconds: number) => {
      if (clockRef.current) clockRef.current.textContent = formatVoiceClock(seconds);
    };
    const onMeta = () => {
      setDuration(el.duration || 0);
      if (el.paused && el.currentTime === 0) writeClock(el.duration || 0);
    };
    const onEnded = () => {
      setPlaying(false);
      writeClock(el.duration || 0);
    };
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnded);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("play", onPlay);
    };
  }, [src]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = audioRef.current;
      if (el && clockRef.current) {
        clockRef.current.textContent = formatVoiceClock(el.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const seek = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const el = audioRef.current;
      if (!el || !duration) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      el.currentTime = ratio * duration;
      if (clockRef.current) {
        clockRef.current.textContent = formatVoiceClock(el.currentTime);
      }
      setScrub((n) => n + 1);
    },
    [duration],
  );

  const readProgress = useCallback(() => {
    const el = audioRef.current;
    if (!el || !el.duration) return 0;
    return Math.min(el.currentTime / el.duration, 1);
  }, []);

  return (
    <div className={cn("flex min-w-[14.5rem] items-center gap-2", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? pauseLabel : playLabel}
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          variant === "outbound"
            ? "bg-black/20 text-primary-foreground"
            : variant === "preview"
              ? "bg-rose-400 text-white"
              : "bg-primary text-primary-foreground",
        )}
      >
        {playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="ml-0.5 h-4 w-4" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={seek}
          aria-label={playLabel}
          className="block w-full"
        >
          <WhatsAppVoiceWave
            peaks={peaks}
            getProgress={readProgress}
            tracking={playing}
            revision={scrub}
            className={
              variant === "inbound"
                ? "[--wave-bar:rgba(0,0,0,0.35)] [--wave-bar-played:#f87171]"
                : variant === "preview"
                  ? "[--wave-bar:rgba(0,0,0,0.4)] [--wave-bar-played:#f87171]"
                  : "[--wave-bar:rgba(0,0,0,0.42)] [--wave-bar-played:#f87171]"
            }
          />
        </button>
        <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
          <span ref={clockRef}>{formatVoiceClock(duration)}</span>
        </div>
      </div>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
    </div>
  );
}
