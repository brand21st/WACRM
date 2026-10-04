'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  POSTBUS_FUTURE_EVENTS,
  POSTBUS_LIVE_EVENTS,
  POSTBUS_TEMPLATE_COLUMNS,
} from '@/lib/postbus/events'
import {
  MASKED_POSTBUS_API_KEY,
  defaultNotificationSettings,
  type PostBusPublicConfig,
} from '@/lib/postbus/config'
import type { PostBusNotificationSettings } from '@/lib/postbus/types'
import type { PostBusTestResultCode } from '@/lib/postbus/types'

const TEST_CODES = [
  'connection_successful',
  'authentication_failed',
  'configuration_missing',
  'api_error',
  'connection_error',
  'not_configured',
  'error',
  'invalid_account',
  'whatsapp_not_configured',
] as const

function emptyForm(accountId: string): PostBusPublicConfig {
  return {
    connected: false,
    status: 'not_connected',
    has_api_key: false,
    id: null,
    account_id: accountId,
    postbus_merchant_id: null,
    routing_mode: 'merchant',
    api_base_url: null,
    connected_at: null,
    last_tested_at: null,
    last_test_result: null,
    notification_settings: defaultNotificationSettings(),
    template_language: 'en_US',
    order_confirmation_template_name: null,
    processing_template_name: null,
    booked_template_name: null,
    in_transit_template_name: null,
    delivered_template_name: null,
    webhook_endpoint_id: null,
    status_webhook_url: null,
    whatsapp_connected: false,
    has_send_api_key: false,
    enabled_notification_count: 0,
    approved_templates: [],
  }
}

export function PostBusConfigDialog({
  open,
  onOpenChange,
  canEdit,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit: boolean
  onSaved: () => void
}) {
  const t = useTranslations('Settings.integrations.postbus')
  const { accountId } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [config, setConfig] = useState<PostBusPublicConfig | null>(null)
  const [merchantId, setMerchantId] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [statusWebhookUrl, setStatusWebhookUrl] = useState('')
  const [notifications, setNotifications] = useState<PostBusNotificationSettings>(
    defaultNotificationSettings(),
  )
  const [templates, setTemplates] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/postbus/config', { cache: 'no-store' })
      const data = (await res.json().catch(() => null)) as PostBusPublicConfig | null
      if (!res.ok || !data) {
        toast.error(
          typeof data === 'object' && data && 'error' in data
            ? String((data as { error?: string }).error)
            : t('loadFailed'),
        )
        return
      }
      setConfig(data)
      setMerchantId(data.postbus_merchant_id ?? '')
      setApiBaseUrl(data.api_base_url ?? '')
      setApiKey(data.has_api_key ? MASKED_POSTBUS_API_KEY : '')
      setStatusWebhookUrl(data.status_webhook_url ?? '')
      setNotifications(data.notification_settings)
      setTemplates({
        order_confirmation_template_name:
          data.order_confirmation_template_name ?? '',
        processing_template_name: data.processing_template_name ?? '',
        booked_template_name: data.booked_template_name ?? '',
        in_transit_template_name: data.in_transit_template_name ?? '',
        delivered_template_name: data.delivered_template_name ?? '',
      })
    } catch {
      toast.error(t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const platformSender = config?.routing_mode === 'global'
  const locked = platformSender || !canEdit

  const save = async () => {
    if (platformSender) return
    setSaving(true)
    try {
      const res = await fetch('/api/postbus/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postbus_merchant_id: merchantId,
          api_base_url: apiBaseUrl,
          api_key: apiKey,
          notification_settings: notifications,
          status_webhook_url: statusWebhookUrl,
          ...templates,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(
          typeof data.error === 'string' ? data.error : t('saveFailed'),
        )
        return
      }
      setConfig(data as PostBusPublicConfig)
      setApiKey(
        (data as PostBusPublicConfig).has_api_key ? MASKED_POSTBUS_API_KEY : '',
      )
      toast.success(t('saved'))
      onSaved()
    } catch {
      toast.error(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/postbus/config/test', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as {
        code?: PostBusTestResultCode
        message?: string
      }
      const code = data.code ?? 'connection_error'
      const key = TEST_CODES.includes(code as (typeof TEST_CODES)[number])
        ? (code as (typeof TEST_CODES)[number])
        : 'connection_error'
      if (key === 'connection_successful') {
        toast.success(t(`testResults.${key}`))
      } else {
        toast.message(t(`testResults.${key}`), {
          description: typeof data.message === 'string' ? data.message : undefined,
        })
      }
      void load()
    } catch {
      toast.error(t('testResults.connection_error'))
    } finally {
      setTesting(false)
    }
  }

  const display = config ?? emptyForm(accountId ?? '')
  const busy = loading || saving || testing
  const approved = display.approved_templates

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {platformSender ? t('platformSenderHint') : t('description')}
          </DialogDescription>
        </DialogHeader>

        {loading && !config ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t('connectionSection')}</h3>
              <p className="text-sm">
                <span className="text-muted-foreground">{t('statusLabel')} </span>
                {t(`status.${display.status}`)}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">{t('whatsappLabel')} </span>
                {display.whatsapp_connected ? t('whatsappYes') : t('whatsappNo')}
              </p>
              {platformSender ? null : (
              <div className="space-y-2">
                <Label htmlFor="postbus-merchant">{t('merchantId')}</Label>
                <Input
                  id="postbus-merchant"
                  value={merchantId}
                  onChange={(e) => setMerchantId(e.target.value)}
                  disabled={locked || busy}
                  autoComplete="off"
                />
              </div>
              )}
              <div className="space-y-2">
                <Label>{t('vachatAccountId')}</Label>
                <Input
                  readOnly
                  value={display.account_id || accountId || ''}
                  className="bg-muted font-mono text-sm text-muted-foreground"
                />
              </div>
            </section>

            {platformSender ? null : (
            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t('notificationsSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('notificationsHint')}</p>
              <div className="space-y-2">
                {POSTBUS_LIVE_EVENTS.map((event) => {
                  const col = POSTBUS_TEMPLATE_COLUMNS[event]
                  return (
                    <div
                      key={event}
                      className="space-y-2 rounded-lg border px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor={`postbus-ev-${event}`} className="text-sm">
                          {t(`events.${event}`)}
                        </Label>
                        <Switch
                          id={`postbus-ev-${event}`}
                          checked={notifications[event]}
                          onCheckedChange={(checked) =>
                            setNotifications((prev) => ({
                              ...prev,
                              [event]: checked,
                            }))
                          }
                          disabled={locked || busy}
                        />
                      </div>
                      <select
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        value={templates[col] ?? ''}
                        disabled={locked || busy}
                        onChange={(e) =>
                          setTemplates((prev) => ({
                            ...prev,
                            [col]: e.target.value,
                          }))
                        }
                      >
                        <option value="">{t('templatePlaceholder')}</option>
                        {approved.map((tpl) => (
                          <option
                            key={`${tpl.name}:${tpl.language}`}
                            value={tpl.name}
                          >
                            {tpl.name} ({tpl.language})
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
                {POSTBUS_FUTURE_EVENTS.map((event) => (
                  <div
                    key={event}
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 opacity-60"
                  >
                    <Label className="text-sm">{t(`events.${event}`)}</Label>
                    <span className="text-xs text-muted-foreground">
                      {t('comingLater')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            )}

            {platformSender ? null : (
            <section className="space-y-2 rounded-lg border bg-muted/40 p-3">
              <h3 className="text-sm font-medium">{t('webhookSection')}</h3>
              <p className="text-xs text-muted-foreground">{t('webhookHint')}</p>
              <div className="space-y-2">
                <Label htmlFor="postbus-webhook">{t('statusWebhookUrl')}</Label>
                <Input
                  id="postbus-webhook"
                  value={statusWebhookUrl}
                  onChange={(e) => setStatusWebhookUrl(e.target.value)}
                  placeholder="https://"
                  disabled={locked || busy}
                  autoComplete="off"
                />
              </div>
              <Link
                href="/settings?tab=api"
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                {t('webhookLink')}
              </Link>
            </section>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={locked || busy || !config}
            onClick={() => void test()}
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('testConnection')}
          </Button>
          <Button
            type="button"
            disabled={locked || busy}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
