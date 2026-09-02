'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { canEditSettings } from '@/lib/auth/roles'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_RECORDING_PURPOSE,
  RECORDING_ANNOUNCEMENT_LANGUAGES,
  parseRecordingAnnouncementLanguage,
  spokenRecordingNotice,
} from '@/lib/calling/settings'

type CallRow = {
  id: string
  from_phone: string | null
  recorded_at: string | null
  recording_key: string | null
  contacts?: { name?: string | null; phone?: string | null } | null
  contact?: { name?: string | null; phone?: string | null } | null
}

const LANG_LABEL_KEYS: Record<string, string> = {
  en: 'langEn',
  en_US: 'langEnUs',
  en_AU: 'langEnAu',
  en_CA: 'langEnCa',
  en_GB: 'langEnGb',
  en_IN: 'langEnIn',
  en_NZ: 'langEnNz',
  nl: 'langNl',
  fr: 'langFr',
  de: 'langDe',
  hi: 'langHi',
  it: 'langIt',
  kn: 'langKn',
  pt: 'langPt',
  es: 'langEs',
  es_ES: 'langEsEs',
  te: 'langTe',
  vi: 'langVi',
}

export function CallingRecordingPage() {
  const t = useTranslations('Calling')
  const { accountRole } = useAuth()
  const canEdit = accountRole ? canEditSettings(accountRole) : false
  const [enabled, setEnabled] = useState(false)
  const [purpose, setPurpose] = useState(DEFAULT_RECORDING_PURPOSE)
  const [language, setLanguage] = useState('en_US')
  const [retention, setRetention] = useState(30)
  const [rows, setRows] = useState<CallRow[]>([])
  const [playing, setPlaying] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [settingsRes, callsRes] = await Promise.all([
      fetch('/api/calling/settings'),
      fetch('/api/calling/calls?kind=recording'),
    ])
    const settingsJson = await settingsRes.json()
    const callsJson = await callsRes.json()
    if (settingsRes.ok) {
      setEnabled(Boolean(settingsJson.settings?.recording_enabled))
      setPurpose(
        typeof settingsJson.settings?.recording_purpose === 'string' &&
          settingsJson.settings.recording_purpose.trim()
          ? settingsJson.settings.recording_purpose
          : DEFAULT_RECORDING_PURPOSE,
      )
      setLanguage(
        parseRecordingAnnouncementLanguage(
          settingsJson.settings?.recording_announcement_language,
        ),
      )
      setRetention(Number(settingsJson.settings?.retention_days ?? 30))
    }
    if (callsRes.ok) setRows(callsJson.calls ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function savePolicy() {
    const res = await fetch('/api/calling/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recording_enabled: enabled,
        recording_purpose: purpose,
        recording_announcement_language: language,
        retention_days: retention,
      }),
    })
    if (!res.ok) {
      toast.error(t('saveFailed'))
      return
    }
    toast.success(t('saved'))
  }

  async function signedUrl(id: string): Promise<string | null> {
    const res = await fetch(`/api/calling/recordings/${id}`)
    const json = await res.json()
    if (!res.ok || typeof json.url !== 'string') return null
    return json.url
  }

  async function play(id: string) {
    const url = await signedUrl(id)
    if (!url) return
    setPlaying(id)
    setAudioUrl(url)
  }

  async function download(id: string) {
    const url = await signedUrl(id)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `${id}.ogg`
    a.rel = 'noopener'
    a.target = '_blank'
    a.click()
  }

  async function remove(id: string) {
    const res = await fetch(`/api/calling/recordings/${id}`, { method: 'DELETE' })
    if (!res.ok) return
    toast.success(t('deleted'))
    void load()
  }

  const notice = spokenRecordingNotice(purpose || DEFAULT_RECORDING_PURPOSE)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('recordingTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('recordingDesc')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('recordingEnable')}</CardTitle>
          <CardDescription>{t('announceHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t('recordingEnable')}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
          </div>
          <label className="block space-y-1 text-sm">
            <span>{t('purposeLabel')}</span>
            <Textarea
              value={purpose}
              maxLength={250}
              disabled={!canEdit}
              onChange={(e) => setPurpose(e.target.value)}
              className="min-h-20"
            />
            <span className="text-xs text-muted-foreground">{t('purposeHint')}</span>
          </label>
          <label className="block space-y-1 text-sm">
            <span>{t('languageLabel')}</span>
            <Select
              value={language}
              onValueChange={(v) => {
                if (typeof v === 'string') setLanguage(parseRecordingAnnouncementLanguage(v))
              }}
            >
              <SelectTrigger className="w-full max-w-md" disabled={!canEdit}>
                <SelectValue>
                  {t(LANG_LABEL_KEYS[language] ?? 'langEnUs')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RECORDING_ANNOUNCEMENT_LANGUAGES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(LANG_LABEL_KEYS[code] ?? 'langEnUs')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {t('announcePreview', { notice })}
          </p>
          <label className="flex items-center gap-2 text-sm">
            {t('retention')}
            <input
              type="number"
              min={1}
              max={365}
              value={retention}
              disabled={!canEdit}
              onChange={(e) => setRetention(Number(e.target.value))}
              className="h-8 w-20 rounded-md border border-border bg-background px-2"
            />
          </label>
          {canEdit && <Button onClick={() => void savePolicy()}>{t('save')}</Button>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('library')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('noRecordings')}</p>
          )}
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 text-sm">
              <div>
                <p className="font-medium">
                  {row.contact?.name || row.contact?.phone || row.contacts?.name || row.contacts?.phone || row.from_phone || t('contact')}
                </p>
                <p className="text-xs text-muted-foreground">{row.recorded_at}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void play(row.id)}>
                  {t('play')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void download(row.id)}>
                  {t('download')}
                </Button>
                {canEdit && (
                  <Button size="sm" variant="destructive" onClick={() => void remove(row.id)}>
                    {t('delete')}
                  </Button>
                )}
              </div>
            </div>
          ))}
          {playing && audioUrl && (
            <audio src={audioUrl} controls autoPlay className="w-full" />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
