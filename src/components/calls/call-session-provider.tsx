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
import type { Call, LiveAiAnswer } from '@/types'
import {
  startCallRingtone,
  stopCallRingtone,
  unlockCallSound,
} from '@/lib/calls/ringtone'
import { RemoteCallAudio } from '@/lib/calls/audio-output'
import { CallWaveAnalyser } from '@/lib/calls/wave-analyser'
import {
  attachRemoteAudio,
  closePeer,
  createInboundPeerConnection,
  replaceSenderAudio,
  setLocalAudioEnabled,
  waitForIceConnected,
} from '@/lib/calls/webrtc'
import { createAiOutbound, primeAiAudio, type AiOutbound } from '@/lib/calls/ai-media'
import { LiveAiRealtimeSession, prefetchLiveAiRealtimeRoute } from '@/lib/calls/live-ai-realtime'
import { liveAiTimeoutMs } from '@/lib/calling/settings'
import {
  CallSessionContext,
  type CallSessionValue,
  type LiveAiTranscriptLine,
} from './call-session-context'
import { CallPopup } from './call-popup'

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
  const [speakerOn, setSpeakerOn] = useState(true)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [callAnalyser, setCallAnalyser] = useState<AnalyserNode | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null)
  const remotePlayerRef = useRef<RemoteCallAudio | null>(null)
  const waveRef = useRef<CallWaveAnalyser | null>(null)
  const activeCallRef = useRef<Call | null>(null)
  const ringingCallRef = useRef<Call | null>(null)
  const speakerOnRef = useRef(true)
  const namesRef = useRef<Map<string, string>>(new Map())
  const answeringRef = useRef(false)
  const liveAiStationRef = useRef(false)
  const liveAiAnswerRef = useRef<LiveAiAnswer>('off')
  const ringTimeoutRef = useRef(45)
  const liveAiRealtimeRef = useRef<LiveAiRealtimeSession | null>(null)
  const aiOutboundRef = useRef<AiOutbound | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const stationArmGenRef = useRef(0)

  const [liveAiStation, setLiveAiStation] = useState(false)
  const [aiOnCall, setAiOnCall] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState<LiveAiTranscriptLine[]>([])

  useEffect(() => {
    activeCallRef.current = activeCall
  }, [activeCall])
  useEffect(() => {
    ringingCallRef.current = ringingCall
  }, [ringingCall])
  useEffect(() => {
    speakerOnRef.current = speakerOn
  }, [speakerOn])

  const applyCallingSettings = useCallback((json: {
    settings?: {
      ring_timeout_seconds?: number
      live_ai_answer?: LiveAiAnswer
    }
  }) => {
    if (!json.settings) return
    if (typeof json.settings.ring_timeout_seconds === 'number') {
      ringTimeoutRef.current = json.settings.ring_timeout_seconds
    }
    liveAiAnswerRef.current = json.settings.live_ai_answer ?? 'off'
  }, [])

  const refreshCallingSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/calling/settings')
      const json = (await res.json()) as {
        settings?: {
          ring_timeout_seconds?: number
          live_ai_answer?: LiveAiAnswer
        }
      }
      if (res.ok) applyCallingSettings(json)
    } catch {
      // Keep last known settings if the refetch fails.
    }
  }, [applyCallingSettings])

  useEffect(() => {
    let cancelled = false
    void refreshCallingSettings().then(() => {
      if (cancelled) return
    })
    return () => {
      cancelled = true
    }
  }, [refreshCallingSettings])

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

  const silencePlayback = useCallback(() => {
    stopCallRingtone()
    remotePlayerRef.current?.silence()
    const el = remoteAudioRef.current
    if (el) {
      el.volume = 0
      el.muted = true
      try {
        el.pause()
      } catch {
        // ignore
      }
    }
  }, [])

  const teardownMedia = useCallback(() => {
    silencePlayback()
    liveAiRealtimeRef.current?.stop()
    liveAiRealtimeRef.current = null
    aiOutboundRef.current?.stop()
    aiOutboundRef.current = null
    remoteStreamRef.current = null
    closePeer(pcRef.current, localStreamRef.current)
    pcRef.current = null
    localStreamRef.current = null
    remotePlayerRef.current?.stop()
    waveRef.current?.stop()
    waveRef.current = null
    setCallAnalyser(null)
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null
    }
    setAiOnCall(false)
    setLiveTranscript([])
  }, [silencePlayback])

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
      const since = new Date(Date.now() - 90_000).toISOString()
      const { data } = await supabase
        .from('calls')
        .select('*')
        .eq('account_id', accountId)
        .eq('status', 'ringing')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
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
            if (!activeCallRef.current && !answeringRef.current) {
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
                setSpeakerOn(true)
              }
            }

            if (active && row.id === active.id) {
              if (
                row.status === 'completed' ||
                row.status === 'failed' ||
                row.status === 'missed' ||
                row.status === 'rejected'
              ) {
                silencePlayback()
                setActiveCall(null)
                teardownMedia()
                setSpeakerOn(true)
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
  }, [accountId, user, supabase, resolveName, teardownMedia, silencePlayback])

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

  const answer = useCallback(async (opts?: { ai?: boolean }) => {
    const call = ringingCallRef.current
    if (!call || answeringRef.current) return
    const ai =
      opts?.ai === true ||
      (opts?.ai !== false &&
        liveAiStationRef.current &&
        liveAiAnswerRef.current === 'ai_first')
    answeringRef.current = true
    unlockCallSound()
    stopCallRingtone()
    if (!remotePlayerRef.current) remotePlayerRef.current = new RemoteCallAudio()
    if (!waveRef.current) waveRef.current = new CallWaveAnalyser()
    const player = remotePlayerRef.current
    const wave = waveRef.current
    // Must run in the Answer click turn — any await drops the autoplay gesture.
    void player.prime()
    void wave.prime()
    const publishWaves = () => {
      setCallAnalyser(wave.node)
    }
    const audioEl = remoteAudioRef.current
    if (audioEl) {
      audioEl.muted = !speakerOnRef.current
      audioEl.volume = speakerOnRef.current ? 1 : 0
      void audioEl.play().catch(() => {})
    }
    setConnecting(true)
    setLiveTranscript([])
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
      if (!audioEl) {
        throw new Error(t('actionFailed'))
      }
      const wireRemote = (peer: RTCPeerConnection) => {
        attachRemoteAudio(peer, audioEl, (el) => {
          const remote =
            el.srcObject instanceof MediaStream ? el.srcObject : null
          if (!remote) return
          remoteStreamRef.current = remote
          liveAiRealtimeRef.current?.setRemote(remote)
          player.attach(remote, speakerOnRef.current, el)
          wave.attachRemote(remote)
          publishWaves()
          for (const track of remote.getAudioTracks()) {
            track.addEventListener('ended', () => silencePlayback())
          }
        })
      }
      let outbound: AiOutbound | null = null
      if (ai) {
        outbound = await createAiOutbound()
        aiOutboundRef.current = outbound
      }
      const { pc, localStream } = await createInboundPeerConnection(
        offerSdp,
        wireRemote,
        outbound ? { localStream: outbound.stream } : undefined,
      )
      pcRef.current = pc
      localStreamRef.current = localStream
      wave.attachLocal(localStream, false)
      publishWaves()
      const hushIfDead = () => {
        if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed' ||
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'closed'
        ) {
          silencePlayback()
        }
      }
      pc.addEventListener('connectionstatechange', hushIfDead)
      pc.addEventListener('iceconnectionstatechange', hushIfDead)
      const sdp = pc.localDescription?.sdp
      if (!sdp) throw new Error(t('actionFailed'))

      await postAction(`/api/whatsapp/calls/${call.id}/pre-accept`, {
        sdp,
        aiAnswered: ai,
      })
      if (ai && outbound) {
        const session = new LiveAiRealtimeSession(
          call.id,
          outbound,
          remoteStreamRef.current,
          {
            onTranscript: (role, text) => {
              setLiveTranscript((prev) => [...prev, { role, text }])
            },
            onHandoff: () => {
              toast.message(t('aiHandoff'))
            },
            onError: (message) => toast.error(message),
          },
        )
        liveAiRealtimeRef.current = session
        session.start()
      }
      await waitForIceConnected(pc)
      await postAction(`/api/whatsapp/calls/${call.id}/accept`, { sdp })
      const remote =
        audioEl.srcObject instanceof MediaStream ? audioEl.srcObject : null
      if (remote) {
        remoteStreamRef.current = remote
        liveAiRealtimeRef.current?.setRemote(remote)
        player.attach(remote, speakerOnRef.current, audioEl)
        wave.attachRemote(remote)
      } else {
        player.setSpeaker(speakerOnRef.current)
      }
      publishWaves()
      setLocalAudioEnabled(localStream, true)
      outbound?.setTrackEnabled(true)
      liveAiRealtimeRef.current?.enableGreeting()
      setMuted(ai)
      setRingingCall(null)
      setActiveCall({
        ...call,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        ai_answered: ai,
      })
      setAiOnCall(ai)
    } catch (err) {
      teardownMedia()
      const code = (err as { code?: string }).code
      if (code === 'already_claimed') {
        toast.error(t('alreadyClaimed'))
        setRingingCall(null)
      } else if (!ai && err instanceof DOMException && err.name === 'NotAllowedError') {
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
      answeringRef.current = false
      setConnecting(false)
    }
  }, [postAction, supabase, t, teardownMedia, silencePlayback])

  const decline = useCallback(async () => {
    const call = ringingCallRef.current
    if (!call) return
    silencePlayback()
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
  }, [postAction, t, silencePlayback])

  const hangUp = useCallback(async () => {
    const call = activeCallRef.current
    silencePlayback()
    teardownMedia()
    setActiveCall(null)
    setMuted(false)
    setSpeakerOn(true)
    if (!call) return
    try {
      await postAction(`/api/whatsapp/calls/${call.id}/terminate`)
    } catch {
      // Terminate webhook may already have closed it.
    }
  }, [postAction, teardownMedia, silencePlayback])

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev
      setLocalAudioEnabled(localStreamRef.current, !next)
      waveRef.current?.setLocalMuted(next)
      return next
    })
  }, [])

  const toggleSpeaker = useCallback(() => {
    setSpeakerOn((prev) => {
      const next = !prev
      speakerOnRef.current = next
      if (!remotePlayerRef.current) remotePlayerRef.current = new RemoteCallAudio()
      remotePlayerRef.current.setSpeaker(next)
      return next
    })
  }, [])

  const openChat = useCallback(() => {
    const convId =
      activeCallRef.current?.conversation_id ||
      ringingCallRef.current?.conversation_id
    if (convId) router.push(`/inbox?c=${convId}`)
  }, [router])

  const registerLiveAiStation = useCallback((on: boolean) => {
    const gen = ++stationArmGenRef.current
    liveAiStationRef.current = on
    setLiveAiStation(on)
    if (!on) return
    unlockCallSound()
    if (!remotePlayerRef.current) remotePlayerRef.current = new RemoteCallAudio()
    void remotePlayerRef.current.prime()
    if (!waveRef.current) waveRef.current = new CallWaveAnalyser()
    void waveRef.current.prime()
    void (async () => {
      await primeAiAudio()
      await refreshCallingSettings()
      if (stationArmGenRef.current !== gen) return
      void prefetchLiveAiRealtimeRoute()
    })()
  }, [refreshCallingSettings])

  const takeOver = useCallback(async () => {
    const pc = pcRef.current
    if (!pc || !aiOnCall) return
    liveAiRealtimeRef.current?.stop()
    liveAiRealtimeRef.current = null
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      })
      await replaceSenderAudio(pc, mic)
      for (const track of mic.getAudioTracks()) track.enabled = true
      const previous = localStreamRef.current
      localStreamRef.current = mic
      waveRef.current?.attachLocal(mic, false)
      setCallAnalyser(waveRef.current?.node ?? null)
      aiOutboundRef.current?.stop()
      aiOutboundRef.current = null
      previous?.getTracks().forEach((t) => t.stop())
      setAiOnCall(false)
      setMuted(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('micDenied'))
    }
  }, [aiOnCall, t])

  useEffect(() => {
    if (!ringingCall || activeCall || connecting) return
    if (!liveAiStation) return
    const callId = ringingCall.id
    const ac = { cancelled: false, timer: 0 }
    void (async () => {
      await refreshCallingSettings()
      if (ac.cancelled) return
      const mode = liveAiAnswerRef.current
      if (mode === 'off') return
      const delay = mode === 'ai_first' ? 400 : liveAiTimeoutMs(ringTimeoutRef.current)
      ac.timer = window.setTimeout(() => {
        if (ringingCallRef.current?.id !== callId) return
        if (activeCallRef.current) return
        void answer({ ai: true })
      }, delay)
      if (ac.cancelled) window.clearTimeout(ac.timer)
    })()
    return () => {
      ac.cancelled = true
      window.clearTimeout(ac.timer)
    }
  }, [ringingCall, activeCall, connecting, liveAiStation, answer, refreshCallingSettings])

  const value: CallSessionValue = {
    ringingCall,
    activeCall,
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
    liveAiStation,
    liveTranscript,
    registerLiveAiStation,
    takeOver,
  }

  return (
    <CallSessionContext.Provider value={value}>
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        aria-hidden
        className="pointer-events-none fixed bottom-0 left-0 z-0 h-8 w-8 opacity-[0.01]"
      />
      {children}
      <CallPopup />
    </CallSessionContext.Provider>
  )
}
