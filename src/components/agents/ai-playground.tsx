'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  RotateCcw,
  Send,
  Loader2,
  UserCircle2,
  ArrowRight,
  Mic,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
  /** Playback URL for a spoken reply (object URL or data URL). */
  audioUrl?: string;
  /** User turn that started as a recording, before STT returns. */
  pending?: boolean;
}

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

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordMs, setRecordMs] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const cancelRef = useRef(false);
  const tickRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending, recording]);

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

  const resetRecording = useCallback(() => {
    clearTimers();
    stopStream();
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setRecordMs(0);
  }, []);

  useEffect(() => {
    return () => {
      resetRecording();
    };
  }, [resetRecording]);

  const sendText = async (text: string, restoreInput = true) => {
    if (!text || sending) return;

    const prior = turns;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No agent configured yet — finish Setup first.');
        } else {
          toast.error(data.error ?? "Couldn't get a reply.");
        }
        setTurns(prior);
        if (restoreInput) setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
        },
      ]);
    } catch {
      toast.error("Couldn't reach the agent.");
      setTurns(prior);
      if (restoreInput) setInput(text);
    } finally {
      setSending(false);
    }
  };

  const sendVoice = async (blob: Blob) => {
    if (sending) return;
    const prior = turns;
    const pending: Turn = { role: 'user', content: 'Listening…', pending: true };
    setTurns([...prior, pending]);
    setSending(true);
    try {
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm';
      form.append('audio', blob, `recording.${ext}`);
      form.append(
        'messages',
        JSON.stringify(
          prior
            .filter((t) => !t.pending && t.content.trim())
            .map((t) => ({ role: t.role, content: t.content })),
        ),
      );
      const res = await fetch('/api/ai/playground/voice', {
        method: 'POST',
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No agent configured yet — finish Setup first.');
        } else if (data.code === 'voice_not_configured') {
          toast.error(
            'Voice is not configured — add a speech key in Voice Agent → Build.',
            {
              action: {
                label: 'Open',
                onClick: () => {
                  window.location.assign('/agents/voice?tab=build');
                },
              },
            },
          );
        } else {
          toast.error(data.error ?? "Couldn't transcribe that recording.");
        }
        setTurns(prior);
        return;
      }
      const transcript =
        typeof data.transcript === 'string' && data.transcript.trim()
          ? data.transcript
          : 'Voice message';
      let audioUrl: string | undefined;
      if (typeof data.audio_base64 === 'string' && data.audio_base64) {
        const mime =
          typeof data.audio_mime_type === 'string'
            ? data.audio_mime_type
            : 'audio/mpeg';
        audioUrl = `data:${mime};base64,${data.audio_base64}`;
      }
      setTurns([
        ...prior,
        { role: 'user', content: transcript },
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
          audioUrl,
        },
      ]);
    } catch {
      toast.error("Couldn't reach the agent.");
      setTurns(prior);
    } finally {
      setSending(false);
    }
  };

  const finishRecording = useCallback(
    (send: boolean) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resetRecording();
        return;
      }
      cancelRef.current = !send;
      recorder.stop();
    },
    [resetRecording],
  );

  const startRecording = async () => {
    if (sending || recording) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      toast.error('Microphone is not available in this browser.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      toast.error('Recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = preferredRecorderMime();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      cancelRef.current = false;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const elapsed = Date.now() - startedAtRef.current;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        resetRecording();
        if (cancelRef.current) return;
        if (elapsed < MIN_RECORDING_MS || blob.size === 0) {
          toast.error('Hold the mic a little longer to record.');
          return;
        }
        void sendVoice(blob);
      };
      mediaRecorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setRecordMs(0);
      setRecording(true);
      recorder.start();
      tickRef.current = window.setInterval(() => {
        setRecordMs(Date.now() - startedAtRef.current);
      }, 200);
      maxTimerRef.current = window.setTimeout(() => {
        finishRecording(true);
      }, MAX_RECORDING_MS);
    } catch (err) {
      resetRecording();
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        toast.error('Microphone permission is required for push-to-talk.');
      } else {
        toast.error("Couldn't access the microphone.");
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendText(input.trim());
    }
  };

  const recordLabel = recording
    ? `${Math.floor(recordMs / 1000)}s — release to send`
    : 'Hold to talk';

  return (
    <div className="flex h-[60vh] min-h-[420px] flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Playground</span>
          <span className="text-xs text-muted-foreground">
            — test replies as if you were a customer
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            finishRecording(false);
            setTurns([]);
          }}
          disabled={(turns.length === 0 && !recording) || sending}
          className="text-muted-foreground"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && !recording && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Bot className="mb-2 h-8 w-8 text-muted-foreground/60" />
            <p>Send a message to see how your agent would reply.</p>
            <p className="mt-1 text-xs">
              Type, or hold the mic for push-to-talk. It uses your knowledge
              base and behaves exactly like the auto-reply bot — including
              handoff.
            </p>
            {onGoToSetup && (
              <Button
                variant="link"
                size="sm"
                onClick={onGoToSetup}
                className="mt-1 h-auto p-0 text-xs"
              >
                Not set up yet? Go to Setup <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {turns.map((t, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              t.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {t.role === 'assistant' && (
              <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />
            )}
            <div
              className={cn(
                'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                t.role === 'user'
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted text-foreground',
              )}
            >
              {t.content && (
                <p className={cn('whitespace-pre-wrap', t.pending && 'italic opacity-80')}>
                  {t.content}
                </p>
              )}
              {t.audioUrl && (
                <audio
                  className="mt-2 w-full"
                  controls
                  preload="metadata"
                  src={t.audioUrl}
                />
              )}
              {t.role === 'assistant' && t.handoff && (
                <p
                  className={cn(
                    'flex items-center gap-1 text-xs text-amber-500',
                    t.content && 'mt-1.5 border-t border-border/50 pt-1.5',
                  )}
                >
                  <UserCircle2 className="h-3.5 w-3.5" />
                  Would hand off to a human here
                </p>
              )}
            </div>
            {t.role === 'user' && (
              <UserCircle2 className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="h-5 w-5 text-primary" />
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a customer message…"
          rows={1}
          disabled={recording}
          className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50 disabled:opacity-60"
        />
        {recording ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => finishRecording(false)}
            className="h-9 shrink-0"
            title="Cancel recording"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={recording ? 'default' : 'outline'}
          disabled={sending}
          className={cn(
            'h-9 shrink-0',
            recording ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'px-2.5',
          )}
          title={recordLabel}
          aria-pressed={recording}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void startRecording();
          }}
          onPointerUp={() => finishRecording(true)}
          onPointerCancel={() => finishRecording(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Mic className="h-4 w-4" />
          {recording ? (
            <span className="ml-1.5 text-xs tabular-nums">
              {Math.floor(recordMs / 1000)}s
            </span>
          ) : null}
        </Button>
        <Button
          size="sm"
          onClick={() => void sendText(input.trim())}
          disabled={!input.trim() || sending || recording}
          className="h-9 w-9 shrink-0 p-0"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
