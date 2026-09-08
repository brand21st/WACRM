'use client'

import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { IntegrationDefinition } from '@/lib/integrations/catalog'
import type { IntegrationConnection } from '@/lib/integrations/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { SettingsChip, StatusDot } from '@/components/settings/settings-chip'

export function IntegrationCard({
  definition,
  connection,
  loading,
  connecting,
  disconnecting,
  canEdit,
  onConnect,
  onDisconnect,
}: {
  definition: IntegrationDefinition
  connection: IntegrationConnection
  loading: boolean
  connecting: boolean
  disconnecting: boolean
  canEdit: boolean
  onConnect: () => void
  onDisconnect: () => void
}) {
  const t = useTranslations('Settings.integrations')
  const Icon = definition.icon
  const status = connection.status
  const hasRow = status !== 'not_connected'
  const busy = loading || connecting || disconnecting

  const chip =
    status === 'connected' ? (
      <SettingsChip variant="ok">
        <StatusDot tone="ok" />
        {t('connected')}
      </SettingsChip>
    ) : status === 'needs_reconnect' ? (
      <SettingsChip variant="warn">{t('needsReconnecting')}</SettingsChip>
    ) : (
      <SettingsChip variant="muted">
        <StatusDot tone="muted" />
        {t('notConnected')}
      </SettingsChip>
    )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-foreground">
                {t(`items.${definition.i18nKey}.name`)}
              </CardTitle>
              {loading ? (
                <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
              ) : (
                chip
              )}
            </div>
            <CardDescription className="mt-1 text-muted-foreground">
              {t(`items.${definition.i18nKey}.description`)}
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      {!loading && (connection.accountLabel || connection.detailLabel || connection.lastSyncedAt) ? (
        <CardContent className="space-y-1.5 text-sm">
          {connection.accountLabel ? (
            <p className="text-foreground">
              <span className="text-muted-foreground">{t('connectedAccount')} </span>
              {connection.accountLabel}
            </p>
          ) : null}
          {connection.detailLabel ? (
            <p className="text-foreground">
              <span className="text-muted-foreground">{t('selectedResource')} </span>
              {connection.detailLabel}
            </p>
          ) : null}
          {connection.lastSyncedAt ? (
            <p className="text-foreground">
              <span className="text-muted-foreground">{t('lastSynced')} </span>
              {new Date(connection.lastSyncedAt).toLocaleString()}
            </p>
          ) : null}
        </CardContent>
      ) : null}

      <CardFooter className="gap-2">
        {status !== 'connected' ? (
          <Button
            type="button"
            disabled={!canEdit || busy}
            onClick={onConnect}
          >
            {connecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {t('connect')}
          </Button>
        ) : null}
        {hasRow ? (
          <Button
            type="button"
            variant="outline"
            disabled={!canEdit || busy}
            onClick={onDisconnect}
          >
            {disconnecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {t('disconnect')}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}
