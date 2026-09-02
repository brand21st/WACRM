'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function CallingComingSoon({
  titleKey,
  descKey,
  bodyKey,
}: {
  titleKey: 'forwardingTitle'
  descKey: 'forwardingDesc'
  bodyKey: 'forwardingBody'
}) {
  const t = useTranslations('Calling')
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t(titleKey)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(descKey)}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('comingSoonTitle')}</CardTitle>
          <CardDescription>{t(bodyKey)}</CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  )
}
