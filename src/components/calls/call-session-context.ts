'use client'

import { createContext, useContext } from 'react'
import type { Call } from '@/types'

export type LiveAiTranscriptLine = { role: 'customer' | 'bot'; text: string }

export interface CallSessionValue {
  ringingCall: Call | null
  activeCall: Call | null
  contactName: string
  connecting: boolean
  muted: boolean
  speakerOn: boolean
  elapsedSeconds: number
  callAnalyser: AnalyserNode | null
  answer: (opts?: { ai?: boolean }) => Promise<void>
  decline: () => Promise<void>
  hangUp: () => Promise<void>
  toggleMute: () => void
  toggleSpeaker: () => void
  openChat: () => void
  aiOnCall: boolean
  liveAiStation: boolean
  liveTranscript: LiveAiTranscriptLine[]
  registerLiveAiStation: (on: boolean) => void
  takeOver: () => Promise<void>
}

export const CallSessionContext = createContext<CallSessionValue | null>(null)

export function useCallSession(): CallSessionValue | null {
  return useContext(CallSessionContext)
}
