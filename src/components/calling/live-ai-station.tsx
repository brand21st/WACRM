'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Phone, PhoneOff, Mic } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useCallSession } from '@/components/calls/call-session-context'
import { formatCallDuration } from '@/lib/calls/preview'

type Payload = {
  settings?: { live_ai_answer?: string }
  live_ai_ready?: boolean
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
  const [payload, setPayload] = useState<Payload | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/calling/settings')
    const json = (await res.json()) as Payload
    if (res.ok) setPayload(json)
    return res.ok ? json : null
  }, [])

  useEffect(() => {
    void load()
    const onVis = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const register = session?.registerLiveAiStation
  useEffect(() => {
    return () => {
      register?.(false)
    }
  }, [register])

  const liveAiReady = Boolean(payload?.live_ai_ready)
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
