'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Phone, PhoneOff, Mic } from 'lucide-react'
import { toast } from 'sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCallSession } from '@/components/calls/call-session-context'
import { useAuth } from '@/hooks/use-auth'
import { formatCallDuration } from '@/lib/calls/preview'
import { prefetchLiveAiRealtimeRoute } from '@/lib/calls/live-ai-realtime'
import type { LiveAiVoice } from '@/types'

type Payload = {
  settings?: {
    live_ai_answer?: string
    live_ai_voice?: LiveAiVoice
    live_ai_behaviour?: string | null
    live_ai_business_context?: string | null
    live_ai_instructions?: string | null
  }
  live_ai_ready?: boolean
  live_ai_tts_available?: boolean
  live_ai_tts_voice?: boolean
  shopify_connected?: boolean
  calling_status?: string
}

function canArmStation(payload: Payload | null): boolean {
  if (!payload) return false
  return (
    Boolean(payload.live_ai_ready) &&
    payload.calling_status === 'enabled' &&
    (payload.settings?.live_ai_answer ?? 'off') !== 'off'
  )
}

export function LiveAiStation() {
  const t = useTranslations('Calling')
  const session = useCallSession()
  const { canEditSettings } = useAuth()
  const [payload, setPayload] = useState<Payload | null>(null)
  const [savingVoice, setSavingVoice] = useState(false)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [behaviour, setBehaviour] = useState('')
  const [businessContext, setBusinessContext] = useState('')
  const [instructions, setInstructions] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/calling/settings')
    const json = (await res.json()) as Payload
    if (res.ok) setPayload(json)
    return res.ok ? json : null
  }, [])

  useEffect(() => {
    void load()
    void prefetchLiveAiRealtimeRoute()
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  useEffect(() => {
    const settings = payload?.settings
    if (!settings) return
    setBehaviour(settings.live_ai_behaviour ?? '')
    setBusinessContext(settings.live_ai_business_context ?? '')
    setInstructions(settings.live_ai_instructions ?? '')
  }, [payload])

  const register = session?.registerLiveAiStation
  useEffect(() => {
    return () => {
      register?.(false)
    }
  }, [register])

  const liveAiReady = Boolean(payload?.live_ai_ready)
  const liveAiTtsAvailable = Boolean(payload?.live_ai_tts_available ?? payload?.live_ai_tts_voice)
  const liveAiVoice: LiveAiVoice =
    payload?.settings?.live_ai_voice === 'openai' ? 'openai' : 'elevenlabs'
  const shopifyConnected = Boolean(payload?.shopify_connected)
  const liveAiAnswer = payload?.settings?.live_ai_answer ?? 'off'
  const callingEnabled = payload?.calling_status === 'enabled'
  const canArm = canArmStation(payload)
  const listening = Boolean(session?.liveAiStation)
  const answering = Boolean(session?.aiOnCall && session.activeCall)
  const status = answering
    ? t('stationAnswering')
    : listening
      ? t('stationListening')
      : t('stationIdle')

  const arm = useCallback(async () => {
    const json = await load()
    if (!canArmStation(json)) return
    session?.registerLiveAiStation(true)
  }, [load, session])

  const disarm = useCallback(() => {
    session?.registerLiveAiStation(false)
  }, [session])

  const saveVoice = useCallback(
    async (voice: LiveAiVoice) => {
      if (voice === liveAiVoice || savingVoice || answering) return
      if (voice === 'elevenlabs' && !liveAiTtsAvailable) return
      setSavingVoice(true)
      try {
        const res = await fetch('/api/calling/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ live_ai_voice: voice }),
        })
        const json = (await res.json().catch(() => ({}))) as Payload & { error?: string }
        if (!res.ok) {
          toast.error(json.error || t('stationVoiceSaveFailed'))
          return
        }
        setPayload(json)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('stationVoiceSaveFailed'))
      } finally {
        setSavingVoice(false)
      }
    },
    [answering, liveAiTtsAvailable, liveAiVoice, savingVoice, t],
  )

  const savePrompt = useCallback(async () => {
    if (!canEditSettings || savingPrompt) return
    setSavingPrompt(true)
    try {
      const res = await fetch('/api/calling/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          live_ai_behaviour: behaviour.trim() || null,
          live_ai_business_context: businessContext.trim() || null,
          live_ai_instructions: instructions.trim() || null,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as Payload & { error?: string }
      if (!res.ok) {
        toast.error(json.error || t('saveFailed'))
        return
      }
      setPayload(json)
      toast.success(t('saved'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'))
    } finally {
      setSavingPrompt(false)
    }
  }, [
    behaviour,
    businessContext,
    canEditSettings,
    instructions,
    savingPrompt,
    t,
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('liveAiTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('liveAiDesc')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{status}</CardTitle>
          <CardDescription>{t('stationKeepOpen')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {payload == null ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : (
            <>
              <CheckRow
                ok={callingEnabled}
                okLabel={t('stationCallingOn')}
                badLabel={t('stationCallingOff')}
                href="/calling/settings"
              />
              <CheckRow
                ok={liveAiReady}
                okLabel={t('stationVoiceReady')}
                badLabel={t('stationVoiceMissing')}
                href="/agents"
              />
              {liveAiReady ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{t('stationVoiceLabel')}</p>
                    <p className="text-xs text-muted-foreground">
                      {liveAiTtsAvailable
                        ? liveAiVoice === 'elevenlabs'
                          ? t('stationTtsVoice')
                          : t('stationVoiceGptHint')
                        : t('stationVoiceNeedKey')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`text-xs ${liveAiVoice === 'openai' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                    >
                      {t('stationVoiceGpt')}
                    </span>
                    <Switch
                      checked={liveAiTtsAvailable && liveAiVoice === 'elevenlabs'}
                      disabled={!liveAiTtsAvailable || savingVoice || answering}
                      onCheckedChange={(on) => {
                        void saveVoice(on ? 'elevenlabs' : 'openai')
                      }}
                    />
                    <span
                      className={`text-xs ${liveAiTtsAvailable && liveAiVoice === 'elevenlabs' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}
                    >
                      {t('stationVoiceEleven')}
                    </span>
                  </div>
                </div>
              ) : null}
              <CheckRow
                ok={shopifyConnected}
                okLabel={t('stationShopifyOn')}
                badLabel={t('stationShopifyOff')}
                href="/settings"
              />
              {liveAiAnswer === 'off' && (
                <p className="text-sm text-destructive">{t('stationModeOff')}</p>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {listening ? (
              <Button type="button" variant="outline" onClick={disarm}>
                {t('stationStop')}
              </Button>
            ) : (
              <Button type="button" onClick={() => void arm()} disabled={payload == null || !canArm}>
                {t('stationStart')}
              </Button>
            )}
            <Link href="/calling/settings" className={buttonVariants({ variant: 'ghost' })}>
              {t('openSettings')}
            </Link>
          </div>
        </CardContent>
      </Card>

      {payload != null && (
        <Card>
          <CardHeader>
            <CardTitle>{t('stationPromptTitle')}</CardTitle>
            <CardDescription>{t('stationPromptDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="live-ai-behaviour">{t('stationBehaviour')}</Label>
              <Textarea
                id="live-ai-behaviour"
                value={behaviour}
                onChange={(e) => setBehaviour(e.target.value)}
                placeholder={t('stationBehaviourPlaceholder')}
                rows={3}
                disabled={!canEditSettings || savingPrompt}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="live-ai-business">{t('stationBusinessContext')}</Label>
              <Textarea
                id="live-ai-business"
                value={businessContext}
                onChange={(e) => setBusinessContext(e.target.value)}
                placeholder={t('stationBusinessPlaceholder')}
                rows={4}
                disabled={!canEditSettings || savingPrompt}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="live-ai-instructions">{t('stationInstructions')}</Label>
              <Textarea
                id="live-ai-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={t('stationInstructionsPlaceholder')}
                rows={4}
                disabled={!canEditSettings || savingPrompt}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('stationPromptInherit')}</p>
            {canEditSettings ? (
              <Button type="button" onClick={() => void savePrompt()} disabled={savingPrompt}>
                {t('save')}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
            )}
          </CardContent>
        </Card>
      )}

      {session?.activeCall && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              {session.contactName}
            </CardTitle>
            <CardDescription>
              {session.aiOnCall ? t('aiAnswering') : t('stationHuman')}
              {session.activeCall.status === 'in_progress'
                ? ` · ${formatCallDuration(session.elapsedSeconds)}`
                : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border p-3 text-sm">
              {session.liveTranscript.length === 0 ? (
                <p className="text-muted-foreground">{t('stationNoTranscript')}</p>
              ) : (
                session.liveTranscript.map((line, i) => (
                  <p key={`${i}-${line.role}`}>
                    <span className="font-medium text-muted-foreground">
                      {line.role === 'customer' ? t('stationCustomer') : t('stationBot')}:
                    </span>{' '}
                    {line.text}
                  </p>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {session.aiOnCall && (
                <Button type="button" onClick={() => void session.takeOver()}>
                  <Mic className="h-4 w-4" />
                  {t('takeOver')}
                </Button>
              )}
              <Button type="button" variant="destructive" onClick={() => void session.hangUp()}>
                <PhoneOff className="h-4 w-4" />
                {t('hangUp')}
              </Button>
              {session.activeCall.conversation_id && (
                <Link
                  href={`/inbox?c=${session.activeCall.conversation_id}`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  {t('openThread')}
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function CheckRow({
  ok,
  okLabel,
  badLabel,
  href,
}: {
  ok: boolean
  okLabel: string
  badLabel: string
  href: string
}) {
  return (
    <p className="text-sm">
      <span className={ok ? 'text-emerald-600' : 'text-destructive'}>
        {ok ? okLabel : badLabel}
      </span>
      {!ok && (
        <>
          {' '}
          <Link href={href} className="text-primary underline-offset-4 hover:underline">
            →
          </Link>
        </>
      )}
    </p>
  )
}
