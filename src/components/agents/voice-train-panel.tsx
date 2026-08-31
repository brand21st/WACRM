'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Mic, Square } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SARVAM_TTS_LANGUAGES } from '@/lib/sarvam/speakers';
import { useAudioRecorder } from './use-audio-recorder';
import { useTranslations } from 'next-intl';
import type { VoiceProvider } from '@/lib/ai/types';

interface ListedVoice {
  voiceId: string;
  name: string;
  category: string;
}

export function VoiceTrainPanel() {
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Agents.voice');
  const { recording, recordMs, start, stop } = useAudioRecorder();

  const [provider, setProvider] = useState<VoiceProvider>('elevenlabs');
  const [loading, setLoading] = useState(true);
  const [voices, setVoices] = useState<ListedVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [stability, setStability] = useState(0.5);
  const [similarity, setSimilarity] = useState(0.75);
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [pace, setPace] = useState(1);
  const [temperature, setTemperature] = useState(0.6);
  const [language, setLanguage] = useState('en-IN');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json().catch(() => ({}));
      const nextProvider: VoiceProvider =
        data.voice_provider === 'sarvam' ? 'sarvam' : 'elevenlabs';
      setProvider(nextProvider);
      if (typeof data.sarvam_pace === 'number') setPace(data.sarvam_pace);
      if (typeof data.sarvam_temperature === 'number') {
        setTemperature(data.sarvam_temperature);
      }
      if (typeof data.sarvam_language_code === 'string') {
        setLanguage(data.sarvam_language_code);
      }
      if (nextProvider === 'elevenlabs' && data.has_elevenlabs_key) {
        const vr = await fetch('/api/ai/voice/voices');
        const vd = await vr.json().catch(() => ({}));
        const list = Array.isArray(vd.voices) ? (vd.voices as ListedVoice[]) : [];
        const cloned = list.filter((v) => v.category === 'cloned');
        setVoices(cloned);
        if (cloned[0] && !voiceId) setVoiceId(cloned[0].voiceId);
      }
    } finally {
      setLoading(false);
    }
  }, [voiceId]);

  useEffect(() => {
    void load();
    // Initial load only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!voiceId || provider !== 'elevenlabs') return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/ai/voice/${encodeURIComponent(voiceId)}`);
      const data = await res.json().catch(() => ({}));
      if (cancelled || !res.ok || !data.settings) return;
      if (typeof data.settings.stability === 'number') {
        setStability(data.settings.stability);
      }
      if (typeof data.settings.similarityBoost === 'number') {
        setSimilarity(data.settings.similarityBoost);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [voiceId, provider]);

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

  const saveElevenLabs = async () => {
    if (!voiceId) return;
    setSaving(true);
    try {
      if (files.length) {
        const form = new FormData();
        for (const file of files) form.append('files', file);
        const res = await fetch(`/api/ai/voice/${encodeURIComponent(voiceId)}`, {
          method: 'PATCH',
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error ?? t('saveFailed'));
          return;
        }
        setFiles([]);
      }
      const res = await fetch(`/api/ai/voice/${encodeURIComponent(voiceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stability,
          similarity_boost: similarity,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('trainSaved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const saveSarvam = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/voice/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_provider: 'sarvam',
          sarvam_pace: pace,
          sarvam_temperature: temperature,
          sarvam_language_code: language,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('trainSaved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!voiceId) return;
    if (!window.confirm(t('deleteConfirm'))) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ai/voice/${encodeURIComponent(voiceId)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('deleted'));
      setVoiceId('');
      await load();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('tabTraining')}</CardTitle>
          <CardDescription>{t('studioDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pace">
              {t('pace')}: {pace.toFixed(2)}
            </Label>
            <input
              id="pace"
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={pace}
              disabled={!canEdit}
              onChange={(e) => setPace(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="temp">
              {t('temperature')}: {temperature.toFixed(2)}
            </Label>
            <input
              id="temp"
              type="range"
              min={0.01}
              max={2}
              step={0.01}
              value={temperature}
              disabled={!canEdit}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label>{t('sarvamLanguage')}</Label>
            <Select
              value={language}
              onValueChange={(v) => v && setLanguage(v)}
              disabled={!canEdit}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SARVAM_TTS_LANGUAGES.map((l) => (
                  <SelectItem key={l.code} value={l.code}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button disabled={!canEdit || saving} onClick={() => void saveSarvam()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('trainSave')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('tabTraining')}</CardTitle>
        <CardDescription>{t('trainPickHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {voices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noVoices')}</p>
        ) : (
          <div className="space-y-2">
            <Label>{t('trainPick')}</Label>
            <Select value={voiceId} onValueChange={(v) => v && setVoiceId(v)} disabled={!canEdit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {voices.map((v) => (
                  <SelectItem key={v.voiceId} value={v.voiceId}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="stability">
            {t('stability')}: {stability.toFixed(2)}
          </Label>
          <input
            id="stability"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={stability}
            disabled={!canEdit || !voiceId}
            onChange={(e) => setStability(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="similarity">
            {t('similarity')}: {similarity.toFixed(2)}
          </Label>
          <input
            id="similarity"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={similarity}
            disabled={!canEdit || !voiceId}
            onChange={(e) => setSimilarity(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="train-files">{t('addSamples')}</Label>
          <Input
            id="train-files"
            type="file"
            accept="audio/*,video/webm"
            multiple
            disabled={!canEdit || !voiceId}
            onChange={(e) => {
              setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!canEdit || !voiceId}
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

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!canEdit || saving || !voiceId}
            onClick={() => void saveElevenLabs()}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('trainSave')}
          </Button>
          <Button
            variant="destructive"
            disabled={!canEdit || saving || !voiceId}
            onClick={() => void handleDelete()}
          >
            {t('deleteVoice')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
