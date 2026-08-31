'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_RECORDING_MS = 400;
const MAX_RECORDING_MS = 60_000;

function preferredRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const clearTimers = () => {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (maxTimerRef.current != null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  };

  const reset = useCallback(() => {
    clearTimers();
    stopStream();
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setRecordMs(0);
  }, []);

  useEffect(() => () => reset(), [reset]);

  const stop = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    else {
      resolveRef.current?.(null);
      resolveRef.current = null;
      reset();
    }
  }, [reset]);

  const start = useCallback(async (): Promise<Blob | null> => {
    if (recording) return null;
    const mime = preferredRecorderMime();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    chunksRef.current = [];
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorderRef.current = rec;
    startedAtRef.current = Date.now();
    setRecording(true);
    setRecordMs(0);
    tickRef.current = window.setInterval(() => {
      setRecordMs(Date.now() - startedAtRef.current);
    }, 200);
    maxTimerRef.current = window.setTimeout(stop, MAX_RECORDING_MS);

    return new Promise((resolve) => {
      resolveRef.current = resolve;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const elapsed = Date.now() - startedAtRef.current;
        const blob =
          elapsed >= MIN_RECORDING_MS && chunksRef.current.length
            ? new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
            : null;
        resolveRef.current?.(blob);
        resolveRef.current = null;
        reset();
      };
      rec.start();
    });
  }, [recording, reset, stop]);

  return { recording, recordMs, start, stop };
}
