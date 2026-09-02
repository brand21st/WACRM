'use client'

import { Phone, PhoneOff, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useCallSession } from './call-session-context'

export function IncomingCallOverlay() {
  const session = useCallSession()
  const t = useTranslations('Calls')
  if (!session?.ringingCall || session.activeCall) return null

  const { contactName, connecting, answer, decline } = session

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-call-title"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
        <p className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('incomingLabel')}
        </p>
        <h2
          id="incoming-call-title"
          className="mt-2 truncate text-center text-xl font-semibold text-foreground"
        >
          {contactName}
        </h2>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {connecting ? t('connecting') : t('incomingHint')}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="destructive"
            className="min-w-28"
            onClick={() => void decline()}
            disabled={connecting}
          >
            <PhoneOff className="h-4 w-4" />
            {t('decline')}
          </Button>
          <Button
            type="button"
            className="min-w-28 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => void answer()}
            disabled={connecting}
          >
            {connecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Phone className="h-4 w-4" />
            )}
            {t('answer')}
          </Button>
        </div>
      </div>
    </div>
  )
}
