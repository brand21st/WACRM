'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import type { Call } from '@/types'
import {
  startCallRingtone,
  stopCallRingtone,
  unlockCallSound,
} from '@/lib/calls/ringtone'
import {
  attachRemoteAudio,
  closePeer,
  createInboundPeerConnection,
  setLocalAudioEnabled,
  waitForIceConnected,
} from '@/lib/calls/webrtc'
import { CallSessionContext, type CallSessionValue } from './call-session-context'
import { IncomingCallOverlay } from './incoming-call-overlay'
import { InCallBar } from './in-call-bar'

type ContactLite = { name?: string | null; phone?: string | null }

export function CallSessionProvider({ children }: { children: ReactNode }) {
  const { user, accountId } = useAuth()
  const router = useRouter()
  const t = useTranslations('Calls')
  const supabase = useMemo(() => createClient(), [])

  const [ringingCall, setRingingCall] = useState<Call | null>(null)
  const [activeCall, setActiveCall] = useState<Call | null>(null)
  const [contactName, setContactName] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [muted, setMuted] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const activeCallRef = useRef<Call | null>(null)
  const ringingCallRef = useRef<Call | null>(null)
  const namesRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    activeCallRef.current = activeCall
  }, [activeCall])
  useEffect(() => {
    ringingCallRef.current = ringingCall
  }, [ringingCall])

  const resolveName = useCallback(
    async (call: Call) => {
      const cached = namesRef.current.get(call.id)
      if (cached) {
        setContactName(cached)
        return cached
      }
      if (!call.contact_id) {
        const fallback = call.from_phone || t('unknownCaller')
        namesRef.current.set(call.id, fallback)
        setContactName(fallback)
        return fallback
      }
      const { data } = await supabase
        .from('contacts')
        .select('name, phone')
        .eq('id', call.contact_id)
        .maybeSingle()
      const contact = data as ContactLite | null
      const name =
        contact?.name?.trim() ||
        contact?.phone ||
        call.from_phone ||
        t('unknownCaller')
      namesRef.current.set(call.id, name)
      setContactName(name)
      return name
    },
    [supabase, t],
  )

  const teardownMedia = useCallback(() => {
    closePeer(pcRef.current, localStreamRef.current)
    pcRef.current = null
    localStreamRef.current = null
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null
    }
  }, [])

  useEffect(() => {
    const unlock = () => unlockCallSound()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    if (ringingCall && !activeCall) {
      startCallRingtone()
    } else {
      stopCallRingtone()
    }
    return () => stopCallRingtone()
  }, [ringingCall, activeCall])

  useEffect(() => {
    if (!activeCall || activeCall.status !== 'in_progress') {
      setElapsedSeconds(0)
      return
    }
    const started = activeCall.started_at
      ? Date.parse(activeCall.started_at)
      : Date.now()
    const tick = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [activeCall])

  useEffect(() => {
    if (!accountId || !user) return

    let cancelled = false

    async function loadRinging() {
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('account_id', accountId)
        .eq('status', 'ringing')
        .order('created_at', { ascending: true })
        .limit(1)
      if (cancelled) return
      const row = (data?.[0] as Call | undefined) ?? null
      if (row) {
        setRingingCall(row)
        void resolveName(row)
      }
    }

    void loadRinging()

    const channel = supabase
      .channel(`calls-${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls' },
        (payload) => {
          const row = payload.new as Call | undefined
          if (!row?.id) return
          if (row.account_id && row.account_id !== accountId) return

          if (payload.eventType === 'INSERT' && row.status === 'ringing') {
            if (!activeCallRef.current && !ringingCallRef.current) {
              setRingingCall(row)
              void resolveName(row)
            }
            return
          }

          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const ringing = ringingCallRef.current
            const active = activeCallRef.current

            if (ringing && row.id === ringing.id && row.status !== 'ringing') {
              if (row.answered_by && row.answered_by !== user.id) {
                setRingingCall(null)
              } else if (
                row.status === 'connecting' ||
                row.status === 'in_progress'
              ) {
                setRingingCall(null)
                setActiveCall(row)
              } else {
                setRingingCall(null)
                teardownMedia()
              }
            }

            if (active && row.id === active.id) {
              if (
                row.status === 'completed' ||
                row.status === 'failed' ||
                row.status === 'missed' ||
                row.status === 'rejected'
              ) {
                setActiveCall(null)
                teardownMedia()
              } else {
                setActiveCall(row)
              }
            }
          }
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [accountId, user, supabase, resolveName, teardownMedia])

  useEffect(() => {
    return () => {
      teardownMedia()
      stopCallRingtone()
    }
  }, [teardownMedia])

  const postAction = useCallback(
    async (path: string, body?: unknown) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        code?: string
        call?: Call
      }
      if (!res.ok) {
        const err = new Error(payload.error || t('actionFailed')) as Error & {
          code?: string
        }
        err.code = payload.code
        throw err
      }
      return payload.call
    },
    [t],
  )

  const answer = useCallback(async () => {
    const call = ringingCallRef.current
    if (!call || connecting) return
    unlockCallSound()
    stopCallRingtone()
    setConnecting(true)
    try {
      const { data: fresh } = await supabase
        .from('calls')
        .select('sdp_offer')
        .eq('id', call.id)
        .maybeSingle()
      const offerSdp = (fresh as { sdp_offer?: string | null } | null)?.sdp_offer
        || call.sdp_offer
      if (!offerSdp) {
        throw new Error(t('missingOffer'))
      }
      const audioEl = remoteAudioRef.current
      if (!audioEl) {
        throw new Error(t('actionFailed'))
      }
      const { pc, localStream } = await createInboundPeerConnection(offerSdp)
      pcRef.current = pc
      localStreamRef.current = localStream
      attachRemoteAudio(pc, audioEl)
      const sdp = pc.localDescription?.sdp
      if (!sdp) throw new Error(t('actionFailed'))

      await postAction(`/api/whatsapp/calls/${call.id}/pre-accept`, { sdp })
      await waitForIceConnected(pc)
      await postAction(`/api/whatsapp/calls/${call.id}/accept`, { sdp })
      setLocalAudioEnabled(localStream, true)
      setMuted(false)
      setRingingCall(null)
      setActiveCall({
        ...call,
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
    } catch (err) {
      teardownMedia()
      const code = (err as { code?: string }).code
      if (code === 'already_claimed') {
        toast.error(t('alreadyClaimed'))
        setRingingCall(null)
      } else if (err instanceof DOMException && err.name === 'NotAllowedError') {
        toast.error(t('micDenied'))
        try {
          await postAction(`/api/whatsapp/calls/${call.id}/reject`)
        } catch {
          // ignore
        }
        setRingingCall(null)
      } else {
        toast.error(err instanceof Error ? err.message : t('iceFailed'))
        try {
          await postAction(`/api/whatsapp/calls/${call.id}/terminate`)
        } catch {
          try {
            await postAction(`/api/whatsapp/calls/${call.id}/reject`)
          } catch {
            // ignore
          }
        }
        setRingingCall(null)
      }
    } finally {
      setConnecting(false)
    }
  }, [connecting, postAction, supabase, t, teardownMedia])

  const decline = useCallback(async () => {
    const call = ringingCallRef.current
    if (!call) return
    stopCallRingtone()
    try {
      await postAction(`/api/whatsapp/calls/${call.id}/reject`)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'already_claimed') {
        toast.error(err instanceof Error ? err.message : t('actionFailed'))
      }
    } finally {
      setRingingCall(null)
    }
  }, [postAction, t])

  const hangUp = useCallback(async () => {
    const call = activeCallRef.current
    teardownMedia()
    setActiveCall(null)
    setMuted(false)
    if (!call) return
    try {
      await postAction(`/api/whatsapp/calls/${call.id}/terminate`)
    } catch {
      // Terminate webhook may already have closed it.
    }
  }, [postAction, teardownMedia])

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      setLocalAudioEnabled(localStreamRef.current, !next)
      return next
    })
  }, [])

  const openChat = useCallback(() => {
    const convId =
      activeCallRef.current?.conversation_id ||
      ringingCallRef.current?.conversation_id
    if (convId) router.push(`/inbox?c=${convId}`)
  }, [router])

  const value: CallSessionValue = {
    ringingCall,
    activeCall,
    contactName,
    connecting,
    muted,
    elapsedSeconds,
    answer,
    decline,
    hangUp,
    toggleMute,
    openChat,
  }

  return (
    <CallSessionContext.Provider value={value}>
      <audio ref={remoteAudioRef} autoPlay className="hidden" />
      {children}
      <IncomingCallOverlay />
      <InCallBar />
    </CallSessionContext.Provider>
  )
}
