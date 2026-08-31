'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Mic, Square, Volume2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SARVAM_SPEAKERS } from '@/lib/sarvam/speakers';
import { playBase64Audio } from './play-preview';
import { useAudioRecorder } from './use-audio-recorder';
import { useTranslations } from 'next-intl';
import type { VoiceProvider } from '@/lib/ai/types';

export function VoiceClonePanel() {
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Agents.voice');
  const { recording, recordMs, start, stop } = useAudioRecorder();

  const [provider, setProvider] = useState<VoiceProvider>('elevenlabs');
  const [hasElKey, setHasElKey] = useState(false);
  const [hasSvKey, setHasSvKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [cloning, setCloning] = useState(false);
  const [clonedId, setClonedId] = useState<string | null>(null);
  const [using, setUsing] = useState(false);
  const [pastedSpeaker, setPastedSpeaker] = useState('');
  const [previewing, setPreviewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json().catch(() => ({}));
      setProvider(data.voice_provider === 'sarvam' ? 'sarvam' : 'elevenlabs');
      setHasElKey(Boolean(data.has_elevenlabs_key));
      setHasSvKey(Boolean(data.has_sarvam_key));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRecord = async () => {
    if (recording) {
      stop();
      return;
    }
    try {
      const blob = await start();
      if (blob) {
        const file = new File(
          [blob],
          blob.type.includes('mp4') ? 'recording.m4a' : 'recording.webm',
          { type: blob.type },
        );
        setFiles((prev) => [...prev, file]);
      }
    } catch {
      toast.error(t('loadFailed'));
    }
  };

  const handleClone = async () => {
    if (!name.trim() || files.length === 0) return;
    setCloning(true);
    try {
      const form = new FormData();
      form.append('name', name.trim());
      if (description.trim()) form.append('description', description.trim());
      for (const file of files) form.append('files', file);
      const res = await fetch('/api/ai/voice/clone', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      setClonedId(typeof data.voice_id === 'string' ? data.voice_id : null);
      toast.success(t('cloneSuccess'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setCloning(false);
    }
  };

  const useVoice = async (payload: Record<string, unknown>) => {
    setUsing(true);
    try {
      const res = await fetch('/api/ai/voice/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('usedForAgent'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setUsing(false);
    }
  };

  const previewSarvam = async (speaker: string) => {
    setPreviewing(speaker);
    try {
      const res = await fetch('/api/ai/voice/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_provider: 'sarvam',
          sarvam_speaker: speaker,
          preview: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('sarvamTestRejected'));
        return;
      }
      if (typeof data.audio_base64 === 'string') {
        await playBase64Audio(
          data.audio_base64,
          typeof data.audio_mime_type === 'string' ? data.audio_mime_type : 'audio/mpeg',
        );
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setPreviewing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (provider === 'sarvam') {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('studioTitle')}</CardTitle>
            <CardDescription>{t('studioDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <a
                  href="https://docs.sarvam.ai/creative-cloning-create"
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              {t('studioCta')}
            </Button>
            <div className="space-y-2">
              <Label htmlFor="cloned-speaker">{t('pasteSpeaker')}</Label>
              <div className="flex gap-2">
                <Input
                  id="cloned-speaker"
                  value={pastedSpeaker}
                  onChange={(e) => setPastedSpeaker(e.target.value)}
                  placeholder="speaker_id"
                  disabled={!canEdit}
                />
                <Button
                  disabled={!canEdit || using || !pastedSpeaker.trim() || !hasSvKey}
                  onClick={() =>
                    void useVoice({
                      voice_provider: 'sarvam',
                      sarvam_speaker: pastedSpeaker.trim(),
                    })
                  }
                >
                  {t('useForAgent')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('pasteSpeakerHint')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('catalogTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-3">
              {SARVAM_SPEAKERS.map((speaker) => (
                <div
                  key={speaker}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className="text-sm font-medium capitalize">{speaker}</span>
                  <div className="flex gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={!hasSvKey || previewing === speaker}
                      onClick={() => void previewSarvam(speaker)}
                      aria-label={t('preview')}
                    >
                      {previewing === speaker ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEdit || using || !hasSvKey}
                      onClick={() =>
                        void useVoice({
                          voice_provider: 'sarvam',
                          sarvam_speaker: speaker,
                        })
                      }
                    >
                      {t('useForAgent')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('tabClone')}</CardTitle>
        {!hasElKey ? (
          <CardDescription>{t('cloneNeedKey')}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasElKey && (
          <p className="text-sm text-muted-foreground">{t('cloneNeedKey')}</p>
        )}
        <div className="space-y-2">
          <Label htmlFor="clone-name">{t('cloneName')}</Label>
          <Input
            id="clone-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('cloneNamePlaceholder')}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="clone-desc">{t('cloneDesc')}</Label>
          <Textarea
            id="clone-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="clone-files">{t('cloneUpload')}</Label>
          <Input
            id="clone-files"
            type="file"
            accept="audio/*,video/webm"
            multiple
            disabled={!canEdit}
            onChange={(e) => {
              const next = Array.from(e.target.files ?? []);
              setFiles((prev) => [...prev, ...next]);
            }}
          />
          {files.length > 0 && (
            <ul className="text-xs text-muted-foreground">
              {files.map((f) => (
                <li key={`${f.name}-${f.size}`}>{f.name}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!canEdit}
            onClick={() => void handleRecord()}
          >
            {recording ? (
              <Square className="mr-2 h-4 w-4" />
            ) : (
              <Mic className="mr-2 h-4 w-4" />
            )}
            {recording
              ? `${t('cloneStop')} (${Math.round(recordMs / 1000)}s)`
              : t('cloneRecord')}
          </Button>
        </div>
        <Button
          disabled={!canEdit || cloning || !hasElKey || !name.trim() || files.length === 0}
          onClick={() => void handleClone()}
        >
          {cloning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t('cloneSubmit')}
        </Button>
        {clonedId && (
          <div className="flex items-center gap-2 rounded-md border border-border p-3 text-sm">
            <code className="flex-1 truncate">{clonedId}</code>
            <Button
              size="sm"
              disabled={!canEdit || using}
              onClick={() =>
                void useVoice({
                  voice_provider: 'elevenlabs',
                  elevenlabs_voice_id: clonedId,
                })
              }
            >
              {t('useForAgent')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
