'use client'

import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export function BillingDueBanner({
  packageName,
  periodEnd,
  onClose,
}: {
  packageName: string | null
  periodEnd: string | null
  onClose: () => void
}) {
  const t = useTranslations('BillingGate')
  const days = daysUntil(periodEnd)
  return (
    <div className="flex w-full items-start gap-3 bg-destructive px-4 py-2.5 text-destructive-foreground sm:px-6">
      <p className="min-w-0 flex-1 text-sm font-medium">
        {t('warnTitle', { plan: packageName || t('fallbackPlan') })}{' '}
        <span className="font-normal">
          {days === 1
            ? t('warnBodyOne', { date: formatDate(periodEnd) })
            : t('warnBody', { days, date: formatDate(periodEnd) })}
        </span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 text-destructive-foreground hover:bg-destructive-foreground/10 hover:text-destructive-foreground"
        onClick={onClose}
        aria-label={t('dismiss')}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}

function daysUntil(iso: string | null) {
  if (!iso) return 0
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}
