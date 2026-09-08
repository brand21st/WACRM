'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/use-auth'
import { INTEGRATIONS } from '@/lib/integrations/catalog'
import {
  emptyConnection,
  parseIntegrationConnection,
  type IntegrationConnection,
  type IntegrationId,
} from '@/lib/integrations/types'
import { SettingsPanelHead } from '@/components/settings/settings-panel-head'

import { IntegrationCard } from './integration-card'

export function IntegrationsPanel() {
  const t = useTranslations('Settings.integrations')
  const { canEditSettings } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [statuses, setStatuses] = useState<
    Record<IntegrationId, IntegrationConnection>
  >(() =>
    Object.fromEntries(
      INTEGRATIONS.map((def) => [def.id, emptyConnection()]),
    ) as Record<IntegrationId, IntegrationConnection>,
  )
  const [loadingId, setLoadingId] = useState<Record<IntegrationId, boolean>>(
    () =>
      Object.fromEntries(INTEGRATIONS.map((def) => [def.id, true])) as Record<
        IntegrationId,
        boolean
      >,
  )
  const [connectingId, setConnectingId] = useState<IntegrationId | null>(null)
  const [disconnectingId, setDisconnectingId] = useState<IntegrationId | null>(
    null,
  )
  const handledReturn = useRef(false)

  const loadStatus = useCallback(async (id: IntegrationId, statusUrl: string) => {
    setLoadingId((prev) => ({ ...prev, [id]: true }))
    try {
      const res = await fetch(statusUrl, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      setStatuses((prev) => ({
        ...prev,
        [id]: parseIntegrationConnection(data),
      }))
    } catch {
      setStatuses((prev) => ({ ...prev, [id]: emptyConnection() }))
    } finally {
      setLoadingId((prev) => ({ ...prev, [id]: false }))
    }
  }, [])

  useEffect(() => {
    for (const def of INTEGRATIONS) {
      void loadStatus(def.id, def.statusUrl)
    }
  }, [loadStatus])

  useEffect(() => {
    if (handledReturn.current) return
    let matched = false
    for (const def of INTEGRATIONS) {
      const ok = searchParams.get(def.oauthReturnParam)
      const err = searchParams.get(`${def.oauthReturnParam}_error`)
      if (!ok && !err) continue
      matched = true
      if (ok === 'connected') {
        toast.success(t('connectedToast'))
        void loadStatus(def.id, def.statusUrl)
      } else if (err) {
        const known = [
          'access_denied',
          'invalid_state',
          'missing_params',
          'not_configured',
          'save_failed',
          'oauth_failed',
        ] as const
        const key = known.find((k) => k === err) ?? 'oauth_failed'
        toast.error(t(`oauthErrors.${key}`))
      }
    }
    if (!matched) return
    handledReturn.current = true
    const params = new URLSearchParams(searchParams.toString())
    for (const def of INTEGRATIONS) {
      params.delete(def.oauthReturnParam)
      params.delete(`${def.oauthReturnParam}_error`)
    }
    const qs = params.toString()
    router.replace(qs ? `/settings?${qs}` : '/settings?tab=integrations', {
      scroll: false,
    })
  }, [loadStatus, router, searchParams, t])

  const connect = async (id: IntegrationId, connectUrl: string) => {
    setConnectingId(id)
    try {
      const res = await fetch(connectUrl, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.authorize_url !== 'string') {
        toast.error(
          typeof data.error === 'string' ? data.error : t('connectFailed'),
        )
        return
      }
      window.location.assign(data.authorize_url)
    } catch {
      toast.error(t('connectFailed'))
    } finally {
      setConnectingId(null)
    }
  }

  const disconnect = async (id: IntegrationId, disconnectUrl: string) => {
    setDisconnectingId(id)
    try {
      const res = await fetch(disconnectUrl, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(
          typeof data.error === 'string' ? data.error : t('disconnectFailed'),
        )
        return
      }
      setStatuses((prev) => ({ ...prev, [id]: emptyConnection() }))
      toast.success(t('disconnected'))
    } catch {
      toast.error(t('disconnectFailed'))
    } finally {
      setDisconnectingId(null)
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="space-y-4">
        {INTEGRATIONS.map((def) => (
          <IntegrationCard
            key={def.id}
            definition={def}
            connection={statuses[def.id] ?? emptyConnection()}
            loading={loadingId[def.id] ?? true}
            connecting={connectingId === def.id}
            disconnecting={disconnectingId === def.id}
            canEdit={canEditSettings}
            onConnect={() => void connect(def.id, def.connectUrl)}
            onDisconnect={() => void disconnect(def.id, def.disconnectUrl)}
          />
        ))}
      </div>
    </section>
  )
}
