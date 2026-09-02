'use client'

import { Mic, MicOff, PhoneOff, MessageSquare } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { formatCallDuration } from '@/lib/calls/preview'
import { useCallSession } from './call-session-context'

export function InCallBar() {
  const session = useCallSession()
  const t = useTranslations('Calls')
  if (!session?.activeCall) return null

  const {
    contactName,
    connecting,
    muted,
    elapsedSeconds,
    hangUp,
    toggleMute,
    openChat,
    activeCall,
  } = session

  const live = activeCall.status === 'in_progress'

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center p-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-border bg-card px-3 py-2 shadow-lg">
        <span className="hidden h-2 w-2 shrink-0 rounded-full bg-emerald-500 sm:inline-flex" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {contactName}
          </p>
          <p className="text-xs text-muted-foreground">
            {connecting || !live
              ? t('connecting')
              : formatCallDuration(elapsedSeconds)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={toggleMute}
            aria-label={muted ? t('unmute') : t('mute')}
            title={muted ? t('unmute') : t('mute')}
            disabled={!live}
          >
            {muted ? (
              <MicOff className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
          {activeCall.conversation_id && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={openChat}
              aria-label={t('openChat')}
              title={t('openChat')}
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="destructive"
            className="h-8 w-8"
            onClick={() => void hangUp()}
            aria-label={t('hangUp')}
            title={t('hangUp')}
          >
            <PhoneOff className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
