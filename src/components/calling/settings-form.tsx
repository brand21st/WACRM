'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { canEditSettings } from '@/lib/auth/roles'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WEEKDAYS, defaultWeeklyHours, hhmmToInput, inputToHhmm } from '@/lib/calling/hours'
import { UpgradePlanBanner } from '@/components/settings/upgrade-plan-banner'
import { useEntitlements } from '@/hooks/use-entitlements'
import type { CallHours, CallHoursDay, CallingSettings } from '@/types'

type Payload = {
  settings: CallingSettings
  calling_status: 'enabled' | 'disabled'
  last_calling_error: string | null
  whatsapp_connected: boolean
  live_ai_ready?: boolean
}

const DAY_KEYS = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'] as const

export function CallingSettingsForm() {
  const t = useTranslations('Calling')
  const { accountRole } = useAuth()
  const canEdit = accountRole ? canEditSettings(accountRole) : false
  const { entitlements } = useEntitlements()
  const planAllowsLiveAi = entitlements?.callingEnabled !== false
  const planAllowsRecording = entitlements?.callRecordingEnabled !== false
  const [payload, setPayload] = useState<Payload | null>(null)
  const [saving, setSaving] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [icon, setIcon] = useState<'DEFAULT' | 'DISABLE_ALL'>('DEFAULT')
  const [hoursOn, setHoursOn] = useState(false)
  const [timezone, setTimezone] = useState('Asia/Kolkata')
  const [weekly, setWeekly] = useState<CallHoursDay[]>(defaultWeeklyHours())
  const [ring, setRing] = useState(45)
  const [recording, setRecording] = useState(false)
  const [transcribe, setTranscribe] = useState(false)
  const [ai, setAi] = useState(false)
  const [liveAi, setLiveAi] = useState<'off' | 'ai_first' | 'after_timeout'>('off')
  const [liveAiReady, setLiveAiReady] = useState(false)

  const apply = useCallback((data: Payload) => {
    setPayload(data)
    setEnabled(data.calling_status === 'enabled')
    setIcon(data.settings.call_icon_visibility)
    const hours = data.settings.call_hours
    setHoursOn(hours?.status === 'ENABLED')
    setTimezone(hours?.timezone_id || 'Asia/Kolkata')
    setWeekly(hours?.weekly_operating_hours?.length ? hours.weekly_operating_hours : defaultWeeklyHours())
    setRing(data.settings.ring_timeout_seconds)
    setRecording(data.settings.recording_enabled)
    setTranscribe(data.settings.transcribe_enabled)
    setAi(data.settings.ai_enabled)
    setLiveAi(data.settings.live_ai_answer ?? 'off')
    setLiveAiReady(Boolean(data.live_ai_ready))
  }, [])

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/calling/settings')
      const json = (await res.json()) as Payload
      if (res.ok) apply(json)
    })()
  }, [apply])

  async function save() {
    setSaving(true)
    try {
      const call_hours: CallHours | null = hoursOn
        ? {
            status: 'ENABLED',
            timezone_id: timezone,
            weekly_operating_hours: weekly,
          }
        : { status: 'DISABLED', timezone_id: timezone, weekly_operating_hours: weekly }

      const res = await fetch('/api/calling/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          call_icon_visibility: icon,
          call_hours,
          ring_timeout_seconds: ring,
          recording_enabled: recording,
          transcribe_enabled: transcribe,
          ai_enabled: ai,
          live_ai_answer: liveAi,
        }),
      })
      const json = (await res.json()) as Payload & { error?: string }
      if (!res.ok) {
        toast.error(json.error || t('saveFailed'))
        return
      }
      apply(json)
      toast.success(t('saved'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('settingsTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('settingsDesc')}</p>
      </div>

      {!canEdit && <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}
      {payload && !payload.whatsapp_connected && (
        <p className="text-sm text-destructive">{t('whatsappDisconnected')}</p>
      )}
      {payload?.last_calling_error && (
        <p className="text-sm text-destructive">
          {t('lastError')}: {payload.last_calling_error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('enable')}</CardTitle>
          <CardDescription>{t('enableDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t('enable')}</span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canEdit}
            />
          </div>
          <div className="space-y-1">
            <p className="text-sm">{t('iconVisibility')}</p>
            <Select
              value={icon}
              onValueChange={(v) => {
                if (v === 'DEFAULT' || v === 'DISABLE_ALL') setIcon(v)
              }}
            >
              <SelectTrigger className="w-full max-w-xs" disabled={!canEdit}>
                <SelectValue>
                  {icon === 'DISABLE_ALL' ? t('iconHidden') : t('iconDefault')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEFAULT">{t('iconDefault')}</SelectItem>
                <SelectItem value="DISABLE_ALL">{t('iconHidden')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            {t('ringTimeout')}
            <input
              type="number"
              min={15}
              max={120}
              value={ring}
              disabled={!canEdit}
              onChange={(e) => setRing(Number(e.target.value))}
              className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
          <p className="text-xs text-muted-foreground">{t('ringTimeoutHint')}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('callHours')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t('callHoursEnabled')}</span>
            <Switch checked={hoursOn} onCheckedChange={setHoursOn} disabled={!canEdit} />
          </div>
          <label className="block text-sm">
            {t('timezone')}
            <input
              value={timezone}
              disabled={!canEdit}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1 h-8 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
          <div className="space-y-2">
            {WEEKDAYS.map((day, i) => {
              const row = weekly.find((w) => w.day_of_week === day) ?? {
                day_of_week: day,
                open_time: '0900',
                close_time: '1800',
              }
              return (
                <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-24">{t(DAY_KEYS[i])}</span>
                  <span className="text-muted-foreground">{t('openTime')}</span>
                  <input
                    type="time"
                    disabled={!canEdit}
                    value={hhmmToInput(row.open_time)}
                    onChange={(e) =>
                      setWeekly((prev) =>
                        WEEKDAYS.map((d) => {
                          const cur = prev.find((p) => p.day_of_week === d) ?? {
                            day_of_week: d,
                            open_time: '0900',
                            close_time: '1800',
                          }
                          return d === day ? { ...cur, open_time: inputToHhmm(e.target.value) } : cur
                        }),
                      )
                    }
                    className="h-8 rounded-md border border-border bg-background px-2"
                  />
                  <span className="text-muted-foreground">{t('closeTime')}</span>
                  <input
                    type="time"
                    disabled={!canEdit}
                    value={hhmmToInput(row.close_time)}
                    onChange={(e) =>
                      setWeekly((prev) =>
                        WEEKDAYS.map((d) => {
                          const cur = prev.find((p) => p.day_of_week === d) ?? {
                            day_of_week: d,
                            open_time: '0900',
                            close_time: '1800',
                          }
                          return d === day ? { ...cur, close_time: inputToHhmm(e.target.value) } : cur
                        }),
                      )
                    }
                    className="h-8 rounded-md border border-border bg-background px-2"
                  />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <UpgradePlanBanner allowed={entitlements?.callRecordingEnabled} />
          <ToggleRow
            label={t('recordingMaster')}
            checked={recording}
            onChange={setRecording}
            disabled={!canEdit || !planAllowsRecording}
          />
          <ToggleRow label={t('transcribeMaster')} checked={transcribe} onChange={setTranscribe} disabled={!canEdit} />
          <ToggleRow
            label={t('aiMaster')}
            checked={ai}
            onChange={setAi}
            disabled={!canEdit || !planAllowsLiveAi}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('liveAiTitle')}</CardTitle>
          <CardDescription>{t('liveAiSettingsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <UpgradePlanBanner allowed={entitlements?.callingEnabled} />
          <Select
            value={liveAi}
            onValueChange={(v) => {
              if (v === 'off' || v === 'ai_first' || v === 'after_timeout') setLiveAi(v)
            }}
          >
            <SelectTrigger className="w-full max-w-md" disabled={!canEdit || !planAllowsLiveAi}>
              <SelectValue>
                {liveAi === 'ai_first'
                  ? t('liveAiFirst')
                  : liveAi === 'after_timeout'
                    ? t('liveAiAfterTimeout')
                    : t('liveAiOff')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t('liveAiOff')}</SelectItem>
              <SelectItem value="ai_first">{t('liveAiFirst')}</SelectItem>
              <SelectItem value="after_timeout">{t('liveAiAfterTimeout')}</SelectItem>
            </SelectContent>
          </Select>
          {!liveAiReady && liveAi !== 'off' && (
            <p className="text-sm text-destructive">{t('liveAiNeedsKeys')}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('liveAiStationHint')}</p>
        </CardContent>
      </Card>

      {canEdit && (
        <Button onClick={() => void save()} disabled={saving}>
          {t('save')}
        </Button>
      )}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}
