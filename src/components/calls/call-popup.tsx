'use client'

import {
  Phone,
  PhoneOff,
  Loader2,
  Mic,
  MicOff,
  MessageSquare,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { formatCallDuration } from '@/lib/calls/preview'
import { useCallSession } from './call-session-context'
import { useCallPopupDrag } from './use-call-popup-drag'
import { CallLiveWave } from './call-live-wave'

export function CallPopup() {
  const session = useCallSession()
  const t = useTranslations('Calls')
  const ringing = session?.ringingCall ?? null
  const activeCall = session?.activeCall ?? null
  const visible = Boolean(ringing || activeCall)
  const { cardRef, offset, handleProps } = useCallPopupDrag(visible)

  if (!session || !visible) return null

  const {
    contactName,
    connecting,
    muted,
    speakerOn,
    elapsedSeconds,
    callAnalyser,
    answer,
    decline,
    hangUp,
    toggleMute,
    toggleSpeaker,
    openChat,
    aiOnCall,
    takeOver,
  } = session

  const incoming = Boolean(ringing && !activeCall)
  const live = activeCall?.status === 'in_progress'
  const statusText = incoming
    ? connecting
      ? t('connecting')
      : t('incomingHint')
    : connecting || !live
      ? t('connecting')
      : formatCallDuration(elapsedSeconds)

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal={false}
      aria-labelledby="call-popup-title"
      className="fixed top-16 right-4 z-[200] w-[min(calc(100%-2rem),20rem)] rounded-xl border border-border bg-card p-4 shadow-lg"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
    >
      <div
        className="cursor-grab select-none touch-none active:cursor-grabbing"
        aria-label={t('dragHandle')}
        {...handleProps}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {incoming
            ? t('incomingLabel')
            : aiOnCall
              ? t('aiAnswering')
              : t('incomingHint')}
        </p>
        <h2
          id="call-popup-title"
          className="mt-1 truncate text-base font-semibold text-foreground"
        >
          {contactName}
        </h2>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {live && (
            <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          )}
          {statusText}
        </p>
      </div>

      {!incoming && <CallLiveWave analyser={callAnalyser} />}

      {incoming ? (
        <div
          className="mt-3 flex items-center gap-2"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={
              speakerOn
                ? 'h-9 w-9 shrink-0 text-emerald-600 hover:text-emerald-700'
                : 'h-9 w-9 shrink-0'
            }
            onClick={toggleSpeaker}
            aria-label={speakerOn ? t('speakerOff') : t('speakerOn')}
            title={speakerOn ? t('speakerOff') : t('speakerOn')}
            aria-pressed={speakerOn}
          >
            {speakerOn ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-w-0 flex-1"
            onClick={() => void decline()}
            disabled={connecting}
          >
            <PhoneOff className="h-4 w-4" />
            {t('decline')}
          </Button>
          <Button
            type="button"
            className="min-w-0 flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
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
      ) : (
        <div
          className="mt-3 flex items-center justify-end gap-1"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {aiOnCall ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void takeOver()}
              disabled={!live}
            >
              <Mic className="h-4 w-4" />
              {t('takeOver')}
            </Button>
          ) : (
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
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={
              speakerOn
                ? 'h-8 w-8 text-emerald-600 hover:text-emerald-700'
                : 'h-8 w-8'
            }
            onClick={toggleSpeaker}
            aria-label={speakerOn ? t('speakerOff') : t('speakerOn')}
            title={speakerOn ? t('speakerOff') : t('speakerOn')}
            aria-pressed={speakerOn}
          >
            {speakerOn ? (
              <Volume2 className="h-4 w-4" />
            ) : (
              <VolumeX className="h-4 w-4" />
            )}
          </Button>
          {activeCall?.conversation_id && (
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
      )}
    </div>
  )
}
