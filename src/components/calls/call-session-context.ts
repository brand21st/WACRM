'use client'

import { createContext, useContext } from 'react'
import type { Call } from '@/types'

export interface CallSessionValue {
  ringingCall: Call | null
  activeCall: Call | null
  contactName: string
  connecting: boolean
  muted: boolean
  elapsedSeconds: number
  answer: () => Promise<void>
  decline: () => Promise<void>
  hangUp: () => Promise<void>
  toggleMute: () => void
  openChat: () => void
}

export const CallSessionContext = createContext<CallSessionValue | null>(null)

export function useCallSession(): CallSessionValue | null {
  return useContext(CallSessionContext)
}
