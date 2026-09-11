import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

const MIN_RECORDING_MS = 400;
const MAX_RECORDING_SECONDS = 60;
const OPUS_ENCODER_PATH = '/opus/encoderWorker.min.js';

export type VoiceRecording = {
  uri: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
};

function fileMetaForUri(uri: string, mimeType?: string): { mimeType: string; fileName: string } {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.includes('ogg') || uri.toLowerCase().includes('.ogg')) {
    return { mimeType: 'audio/ogg', fileName: `voice-${Date.now()}.ogg` };
  }
  if (mime.includes('m4a') || mime.includes('mp4') || uri.toLowerCase().includes('.m4a')) {
    return { mimeType: 'audio/mp4', fileName: `voice-${Date.now()}.m4a` };
  }
  if (mime.includes('amr') || uri.toLowerCase().includes('.3gp')) {
    return { mimeType: 'audio/amr', fileName: `voice-${Date.now()}.amr` };
  }
  if (uri.toLowerCase().includes('.caf')) {
    return { mimeType: 'audio/mp4', fileName: `voice-${Date.now()}.m4a` };
  }
  return { mimeType: 'audio/mp4', fileName: `voice-${Date.now()}.m4a` };
}

type WebRecorderRefs = {
  stream: MediaStream | null;
  audioCtx: AudioContext | null;
  analyser: AnalyserNode | null;
  samples: Uint8Array<ArrayBuffer> | null;
  recorder: import('opus-recorder').default | null;
  startedAt: number;
  tick: ReturnType<typeof setInterval> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  objectUrl: string | null;
  cancelled: boolean;
  stopping: boolean;
  stopResolve: ((clip: VoiceRecording | null) => void) | null;
};

function normalizeMeter(metering?: number): number {
  if (typeof metering !== 'number' || Number.isNaN(metering)) return 0.2;
  const clamped = Math.max(-60, Math.min(0, metering));
  return 0.15 + ((clamped + 60) / 60) * 0.85;
}

function peakFromAnalyser(analyser: AnalyserNode, samples: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(samples);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const n = Math.abs((samples[i] - 128) / 128);
    if (n > peak) peak = n;
  }
  return Math.max(0.15, Math.min(1, peak * 1.85));
}

function useWebVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [meterLevel, setMeterLevel] = useState(0.2);
  const [draft, setDraft] = useState<VoiceRecording | null>(null);
  const refs = useRef<WebRecorderRefs>({
    stream: null,
    audioCtx: null,
    analyser: null,
    samples: null,
    recorder: null,
    startedAt: 0,
    tick: null,
    maxTimer: null,
    objectUrl: null,
    cancelled: false,
    stopping: false,
    stopResolve: null,
  });

  const clearTimers = useCallback(() => {
    if (refs.current.tick) clearInterval(refs.current.tick);
    if (refs.current.maxTimer) clearTimeout(refs.current.maxTimer);
    refs.current.tick = null;
    refs.current.maxTimer = null;
  }, []);

  const releaseHardware = useCallback(() => {
    refs.current.stream?.getTracks().forEach((track) => track.stop());
    refs.current.stream = null;
    void refs.current.audioCtx?.close().catch(() => {});
    refs.current.audioCtx = null;
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    releaseHardware();
    refs.current.recorder = null;
    refs.current.analyser = null;
    refs.current.samples = null;
    refs.current.startedAt = 0;
    refs.current.cancelled = false;
    refs.current.stopping = false;
    refs.current.stopResolve = null;
    if (refs.current.objectUrl) {
      URL.revokeObjectURL(refs.current.objectUrl);
      refs.current.objectUrl = null;
    }
    setIsRecording(false);
    setDurationMs(0);
    setMeterLevel(0.2);
    setDraft(null);
  }, [clearTimers, releaseHardware]);

  useEffect(() => () => reset(), [reset]);

  const pauseRef = useRef<() => Promise<void>>(async () => {});

  const start = useCallback(async (): Promise<boolean> => {
    if (isRecording || refs.current.stopping || draft) return false;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;

    reset();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      refs.current.stream = stream;

      const audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
      refs.current.audioCtx = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      refs.current.analyser = analyser;
      refs.current.samples = new Uint8Array(analyser.fftSize);

      const opus = await import('opus-recorder');
      const Recorder = opus.default;
      if (!Recorder.isRecordingSupported()) {
        reset();
        return false;
      }

      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048,
        encoderSampleRate: 48000,
        streamPages: false,
        sourceNode: source,
        monitorGain: 0,
      });
      recorder.ondataavailable = (bytes: Uint8Array) => {
        if (refs.current.cancelled) return;
        const resolve = refs.current.stopResolve;
        if (!resolve) return;
        refs.current.stopResolve = null;

        const elapsed = Date.now() - refs.current.startedAt;
        if (bytes.length === 0 || elapsed < MIN_RECORDING_MS) {
          resolve(null);
          return;
        }
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'audio/ogg' });
        if (refs.current.objectUrl) URL.revokeObjectURL(refs.current.objectUrl);
        const uri = URL.createObjectURL(blob);
        refs.current.objectUrl = uri;
        resolve({
          uri,
          fileName: `voice-${Date.now()}.ogg`,
          mimeType: 'audio/ogg',
          durationMs: elapsed,
        });
      };
      recorder.onstop = () => {};
      refs.current.recorder = recorder;
      await recorder.start();
      recorder.setMonitorGain?.(0);

      refs.current.startedAt = Date.now();
      setIsRecording(true);
      setDurationMs(0);
      refs.current.tick = setInterval(() => {
        setDurationMs(Date.now() - refs.current.startedAt);
        if (refs.current.analyser && refs.current.samples) {
          setMeterLevel(peakFromAnalyser(refs.current.analyser, refs.current.samples));
        }
      }, 90);
      refs.current.maxTimer = setTimeout(() => {
        void pauseRef.current();
      }, MAX_RECORDING_SECONDS * 1000);
      return true;
    } catch {
      reset();
      return false;
    }
  }, [draft, isRecording, reset]);

  const cancel = useCallback(async () => {
    refs.current.cancelled = true;
    refs.current.stopResolve = null;
    const recorder = refs.current.recorder;
    if (recorder) {
      await recorder.stop().catch(() => {});
    }
    reset();
  }, [reset]);

  const finishCapture = useCallback(async (): Promise<VoiceRecording | null> => {
    const recorder = refs.current.recorder;
    if (!recorder || refs.current.stopping) {
      return null;
    }

    refs.current.stopping = true;
    refs.current.cancelled = false;
    const clip = await new Promise<VoiceRecording | null>((resolve) => {
      refs.current.stopResolve = resolve;
      void recorder.stop().catch(() => {
        if (refs.current.stopResolve) {
          refs.current.stopResolve(null);
          refs.current.stopResolve = null;
        }
      });
    });

    clearTimers();
    releaseHardware();
    refs.current.recorder = null;
    refs.current.stopping = false;
    setIsRecording(false);
    return clip;
  }, [clearTimers, releaseHardware]);

  const pause = useCallback(async () => {
    const clip = await finishCapture();
    if (clip) {
      setDraft(clip);
      setDurationMs(clip.durationMs);
      return;
    }
    setDurationMs(0);
  }, [finishCapture]);

  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    if (draft) {
      const clip = draft;
      setDraft(null);
      setDurationMs(0);
      setMeterLevel(0.2);
      return clip;
    }
    const clip = await finishCapture();
    setDurationMs(0);
    setMeterLevel(0.2);
    return clip;
  }, [draft, finishCapture]);

  useEffect(() => {
    pauseRef.current = pause;
  }, [pause]);

  return { isRecording, durationMs, meterLevel, draft, start, stop, pause, cancel };
}

function useNativeVoiceRecorder() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const state = useAudioRecorderState(recorder, 200);
  const [draft, setDraft] = useState<VoiceRecording | null>(null);
  const stoppingRef = useRef(false);
  const startedAtRef = useRef(0);

  const start = useCallback(async (): Promise<boolean> => {
    if (state.isRecording || stoppingRef.current || draft) return false;

    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) return false;

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    await recorder.prepareToRecordAsync();
    recorder.record({ forDuration: MAX_RECORDING_SECONDS });
    startedAtRef.current = Date.now();
    setDraft(null);
    return true;
  }, [draft, recorder, state.isRecording]);

  const finishCapture = useCallback(async (): Promise<VoiceRecording | null> => {
    if (!state.isRecording && !recorder.uri) return null;

    stoppingRef.current = true;
    try {
      await recorder.stop();
    } finally {
      stoppingRef.current = false;
    }

    const uri = recorder.uri;
    const durationMs = Math.max(
      state.durationMillis,
      startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0,
    );
    startedAtRef.current = 0;
    if (!uri || durationMs < MIN_RECORDING_MS) return null;

    const { mimeType, fileName } = fileMetaForUri(uri);
    return { uri, fileName, mimeType, durationMs };
  }, [recorder, state.durationMillis, state.isRecording]);

  const cancel = useCallback(async () => {
    setDraft(null);
    if (!state.isRecording) {
      startedAtRef.current = 0;
      return;
    }
    stoppingRef.current = true;
    try {
      await recorder.stop();
    } finally {
      stoppingRef.current = false;
      startedAtRef.current = 0;
    }
  }, [recorder, state.isRecording]);

  const pause = useCallback(async () => {
    const clip = await finishCapture();
    if (clip) setDraft(clip);
  }, [finishCapture]);

  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    if (draft) {
      const clip = draft;
      setDraft(null);
      return clip;
    }
    return finishCapture();
  }, [draft, finishCapture]);

  return {
    isRecording: state.isRecording,
    durationMs: draft?.durationMs ?? state.durationMillis,
    meterLevel: normalizeMeter(state.metering),
    draft,
    start,
    stop,
    pause,
    cancel,
  };
}

export function useVoiceRecorder() {
  const web = useWebVoiceRecorder();
  const native = useNativeVoiceRecorder();
  return Platform.OS === 'web' ? web : native;
}
