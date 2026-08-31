'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Volume2,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import type { VoiceProvider, VoiceReplyMode } from '@/lib/ai/types';
import {
  REALTIME_VOICES,
  DEFAULT_REALTIME_VOICE,
  parseRealtimeVoice,
  type RealtimeVoice,
} from '@/lib/ai/realtime/voices';
import {
  SARVAM_SPEAKERS,
  SARVAM_TTS_LANGUAGES,
} from '@/lib/sarvam/speakers';
import { playBase64Audio } from './play-preview';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';

const VOICE_REPLY_MODES: {
  value: VoiceReplyMode;
  labelKey: 'replyModeSame' | 'replyModeText' | 'replyModeAudio' | 'replyModeBoth';
}[] = [
  { value: 'same', labelKey: 'replyModeSame' },
  { value: 'text', labelKey: 'replyModeText' },
  { value: 'audio', labelKey: 'replyModeAudio' },
  { value: 'both', labelKey: 'replyModeBoth' },
];

export function VoiceBuildPanel() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Agents.voice');
  const tc = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [chatProvider, setChatProvider] = useState<'openai' | 'anthropic'>('openai');

  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>('elevenlabs');
  const [elevenlabsKey, setElevenlabsKey] = useState('');
  const [elevenlabsKeyEdited, setElevenlabsKeyEdited] = useState(false);
  const [hasStoredElevenlabsKey, setHasStoredElevenlabsKey] = useState(false);
  const [showElevenlabsKey, setShowElevenlabsKey] = useState(false);
  const [elevenlabsVoiceId, setElevenlabsVoiceId] = useState('');
  const [sarvamKey, setSarvamKey] = useState('');
  const [sarvamKeyEdited, setSarvamKeyEdited] = useState(false);
  const [hasStoredSarvamKey, setHasStoredSarvamKey] = useState(false);
  const [showSarvamKey, setShowSarvamKey] = useState(false);
  const [sarvamSpeaker, setSarvamSpeaker] = useState('shubh');
  const [sarvamLanguage, setSarvamLanguage] = useState('en-IN');
  const [sttEnabled, setSttEnabled] = useState(true);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [voiceReplyMode, setVoiceReplyMode] = useState<VoiceReplyMode>('same');
  const [realtimeVoiceEnabled, setRealtimeVoiceEnabled] = useState(false);
  const [realtimeVoice, setRealtimeVoice] = useState<RealtimeVoice>(
    DEFAULT_REALTIME_VOICE,
  );
  const [testingVoice, setTestingVoice] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailed'));
        return;
      }
      if (!data.configured) {
        setConfigured(false);
        return;
      }
      setConfigured(true);
      setChatProvider(data.provider === 'anthropic' ? 'anthropic' : 'openai');
      setVoiceProvider(data.voice_provider === 'sarvam' ? 'sarvam' : 'elevenlabs');
      setHasStoredElevenlabsKey(Boolean(data.has_elevenlabs_key));
      setElevenlabsKey(data.has_elevenlabs_key ? MASKED_KEY : '');
      setElevenlabsKeyEdited(false);
      setElevenlabsVoiceId(data.elevenlabs_voice_id ?? '');
      setHasStoredSarvamKey(Boolean(data.has_sarvam_key));
      setSarvamKey(data.has_sarvam_key ? MASKED_KEY : '');
      setSarvamKeyEdited(false);
      setSarvamSpeaker(data.sarvam_speaker || 'shubh');
      setSarvamLanguage(data.sarvam_language_code || 'en-IN');
      setSttEnabled(data.stt_enabled !== false);
      setTtsEnabled(data.tts_enabled !== false);
      setVoiceReplyMode(
        data.voice_reply_mode === 'text' ||
          data.voice_reply_mode === 'audio' ||
          data.voice_reply_mode === 'both'
          ? data.voice_reply_mode
          : 'same',
      );
      setRealtimeVoiceEnabled(Boolean(data.realtime_voice_enabled));
      setRealtimeVoice(
        parseRealtimeVoice(data.realtime_voice) ?? DEFAULT_REALTIME_VOICE,
      );
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  const elevenlabsKeyPayload = () =>
    elevenlabsKeyEdited ? elevenlabsKey.trim() || null : undefined;
  const sarvamKeyPayload = () =>
    sarvamKeyEdited ? sarvamKey.trim() || null : undefined;

  const runVoiceTest = async (preview: boolean) => {
    if (preview) setPreviewingVoice(true);
    else setTestingVoice(true);
    try {
      const res = await fetch('/api/ai/voice/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          voiceProvider === 'sarvam'
            ? {
                voice_provider: 'sarvam',
                sarvam_api_key: sarvamKeyPayload(),
                sarvam_speaker: sarvamSpeaker,
                sarvam_language_code: sarvamLanguage,
                preview,
              }
            : {
                voice_provider: 'elevenlabs',
                elevenlabs_api_key: elevenlabsKeyPayload(),
                elevenlabs_voice_id: elevenlabsVoiceId.trim() || null,
                preview,
              },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          data.error ??
            (voiceProvider === 'sarvam'
              ? t('sarvamTestRejected')
              : tc('voiceTestRejected')),
        );
        return;
      }
      if (preview && typeof data.audio_base64 === 'string') {
        const mime =
          typeof data.audio_mime_type === 'string'
            ? data.audio_mime_type
            : 'audio/mpeg';
        try {
          await playBase64Audio(data.audio_base64, mime);
          toast.success(tc('voicePreviewSuccess'));
        } catch {
          toast.error(tc('voicePreviewPlayFailed'));
        }
      } else {
        toast.success(
          voiceProvider === 'sarvam'
            ? t('sarvamTestSuccess')
            : tc('voiceTestSuccess'),
        );
      }
    } catch {
      toast.error(tc('testNetworkError'));
    } finally {
      setTestingVoice(false);
      setPreviewingVoice(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/voice/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_provider: voiceProvider,
          elevenlabs_api_key: elevenlabsKeyPayload(),
          elevenlabs_voice_id: elevenlabsVoiceId.trim() || null,
          sarvam_api_key: sarvamKeyPayload(),
          sarvam_speaker: sarvamSpeaker,
          sarvam_language_code: sarvamLanguage,
          stt_enabled: sttEnabled,
          tts_enabled: ttsEnabled,
          voice_reply_mode: voiceReplyMode,
          realtime_voice_enabled:
            realtimeVoiceEnabled &&
            chatProvider === 'openai' &&
            voiceProvider === 'elevenlabs',
          realtime_voice: realtimeVoice,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(t('saveSuccess'));
        await fetchConfig();
      } else {
        toast.error(data.error ?? t('saveFailed'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (!configured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('needSetupTitle')}</CardTitle>
          <CardDescription>{t('needSetupDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button nativeButton={false} render={<Link href="/agents" />}>{t('goToSetup')}</Button>
        </CardContent>
      </Card>
    );
  }

  const disabled = !canEdit || saving;
  const showRealtime = chatProvider === 'openai' && voiceProvider === 'elevenlabs';

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t('tabBuild')} description={t('providerDesc')} />

      {!canEdit && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnly')}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('provider')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={voiceProvider}
            onValueChange={(v) => v && setVoiceProvider(v as VoiceProvider)}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="elevenlabs">{t('providerElevenlabs')}</SelectItem>
              <SelectItem value="sarvam">{t('providerSarvam')}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {voiceProvider === 'elevenlabs' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Volume2 className="h-4 w-4 text-primary" /> {tc('voiceTitle')}
            </CardTitle>
            <CardDescription>{tc('voiceDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-elevenlabs-key">{tc('elevenlabsKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-elevenlabs-key"
                    type={showElevenlabsKey ? 'text' : 'password'}
                    value={elevenlabsKey}
                    onChange={(e) => {
                      setElevenlabsKey(e.target.value);
                      setElevenlabsKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!elevenlabsKeyEdited && hasStoredElevenlabsKey) {
                        setElevenlabsKey('');
                        setElevenlabsKeyEdited(true);
                      }
                    }}
                    placeholder="xi-..."
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowElevenlabsKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showElevenlabsKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void runVoiceTest(false)}
                  disabled={disabled || testingVoice || previewingVoice}
                >
                  {testingVoice ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {tc('testVoice')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{tc('elevenlabsKeyHint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-voice-id">{tc('voiceId')}</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-voice-id"
                  value={elevenlabsVoiceId}
                  onChange={(e) => setElevenlabsVoiceId(e.target.value)}
                  placeholder={tc('voiceIdPlaceholder')}
                  disabled={disabled}
                  autoComplete="off"
                />
                <Button
                  variant="outline"
                  onClick={() => void runVoiceTest(true)}
                  disabled={disabled || testingVoice || previewingVoice}
                >
                  {previewingVoice ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                  {tc('previewVoice')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{tc('voiceIdHint')}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Volume2 className="h-4 w-4 text-primary" /> {t('providerSarvam')}
            </CardTitle>
            <CardDescription>{t('sarvamHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-sarvam-key">{t('sarvamKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-sarvam-key"
                    type={showSarvamKey ? 'text' : 'password'}
                    value={sarvamKey}
                    onChange={(e) => {
                      setSarvamKey(e.target.value);
                      setSarvamKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!sarvamKeyEdited && hasStoredSarvamKey) {
                        setSarvamKey('');
                        setSarvamKeyEdited(true);
                      }
                    }}
                    placeholder="sk_..."
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSarvamKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showSarvamKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void runVoiceTest(false)}
                  disabled={disabled || testingVoice || previewingVoice}
                >
                  {testingVoice ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {tc('testVoice')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('sarvamKeyHint')}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('sarvamSpeaker')}</Label>
                <Select
                  value={sarvamSpeaker}
                  onValueChange={(v) => v && setSarvamSpeaker(v)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SARVAM_SPEAKERS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('sarvamLanguage')}</Label>
                <Select
                  value={sarvamLanguage}
                  onValueChange={(v) => v && setSarvamLanguage(v)}
                  disabled={disabled}
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
            </div>
            <Button
              variant="outline"
              onClick={() => void runVoiceTest(true)}
              disabled={disabled || testingVoice || previewingVoice}
            >
              {previewingVoice ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Volume2 className="mr-2 h-4 w-4" />
              )}
              {tc('previewVoice')}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{tc('sttEnabled')}</p>
              <p className="text-xs text-muted-foreground">{tc('sttEnabledDesc')}</p>
            </div>
            <Switch
              checked={sttEnabled}
              onCheckedChange={setSttEnabled}
              disabled={disabled}
            />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{tc('ttsEnabled')}</p>
              <p className="text-xs text-muted-foreground">{tc('ttsEnabledDesc')}</p>
            </div>
            <Switch
              checked={ttsEnabled}
              onCheckedChange={setTtsEnabled}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-reply-mode">{tc('replyMode')}</Label>
            <p className="text-xs text-muted-foreground">{tc('replyModeDesc')}</p>
            <Select
              value={voiceReplyMode}
              onValueChange={(v) => setVoiceReplyMode(v as VoiceReplyMode)}
              disabled={disabled}
            >
              <SelectTrigger id="ai-reply-mode" className="w-full max-w-md">
                <SelectValue>
                  {tc(
                    VOICE_REPLY_MODES.find((m) => m.value === voiceReplyMode)
                      ?.labelKey ?? 'replyModeSame',
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {VOICE_REPLY_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {tc(m.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showRealtime ? (
            <>
              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {tc('realtimeVoice')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {tc('realtimeVoiceDesc')}
                  </p>
                </div>
                <Switch
                  checked={realtimeVoiceEnabled}
                  onCheckedChange={setRealtimeVoiceEnabled}
                  disabled={disabled || !ttsEnabled}
                />
              </div>
              {realtimeVoiceEnabled ? (
                <div className="space-y-2">
                  <Label htmlFor="ai-realtime-voice">{tc('realtimeVoicePick')}</Label>
                  <Select
                    value={realtimeVoice}
                    onValueChange={(v) => setRealtimeVoice(v as RealtimeVoice)}
                    disabled={disabled || !ttsEnabled}
                  >
                    <SelectTrigger id="ai-realtime-voice">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REALTIME_VOICES.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      {canEdit && (
        <Button onClick={() => void handleSave()} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {saving ? t('saving') : t('save')}
        </Button>
      )}
    </div>
  );
}
