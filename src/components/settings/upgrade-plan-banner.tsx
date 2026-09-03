'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

export function UpgradePlanBanner({ allowed }: { allowed?: boolean }) {
  const t = useTranslations('Settings.upgradePlan')
  if (allowed !== false) return null

  return (
    <div className="mb-4 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
      <p className="text-foreground">{t('message')}</p>
      <Link
        href="/settings?tab=billing"
        className="mt-1 inline-block font-medium text-primary hover:underline"
      >
        {t('cta')}
      </Link>
    </div>
  )
}
