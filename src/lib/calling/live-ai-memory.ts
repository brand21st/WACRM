import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from '@/lib/ai/context'
import { detectSpokenIndicTarget, INDIC_LANGUAGE_NAMES } from '@/lib/ai/indic-language'
import type { ChatMessage } from '@/lib/ai/types'

export const LIVE_AI_MEMORY_THREAD = 16
export const LIVE_AI_MEMORY_SEARCH_LIMIT = 40
export const LIVE_AI_MEMORY_NOTES = 8

export type LiveAiMemoryLine = {
  role: 'customer' | 'assistant'
  text: string
}

export type LiveAiCustomerMemory = {
  notes: string[]
  /** Last turns injected into the spoken prompt. */
  thread: LiveAiMemoryLine[]
  /** Full loaded thread for mid-call search. */
  recall: LiveAiMemoryLine[]
  languageHint: string | null
}

export function isLiveAiNoiseTranscript(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (/^call:(completed|missed|rejected)/i.test(t)) return true
  if (/^Call recording$/i.test(t)) return true
  if (/this call will be recorded/i.test(t)) return true
  if (/will be recorded for the following purpose/i.test(t)) return true
  return false
}

export function memoryLinesFromThread(messages: ChatMessage[]): LiveAiMemoryLine[] {
  return messages
    .filter((m) => !isLiveAiNoiseTranscript(m.content))
    .map((m) => ({
      role: m.role === 'user' ? ('customer' as const) : ('assistant' as const),
      text: m.content.trim(),
    }))
    .filter((line) => line.text.length > 0)
}

export function detectLiveAiLanguageHint(thread: LiveAiMemoryLine[]): string | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const line = thread[i]
    if (line.role !== 'customer') continue
    const code = detectSpokenIndicTarget(line.text)?.elevenlabs
    if (code) return INDIC_LANGUAGE_NAMES[code] ?? code
  }
  return null
}

export function formatLiveAiMemoryBlock(memory: LiveAiCustomerMemory): string {
  const parts: string[] = []
  if (memory.notes.length > 0) {
    parts.push(
      `Staff notes about this customer:\n${memory.notes.map((n) => `- ${n}`).join('\n')}`,
    )
  }
  if (memory.thread.length > 0) {
    parts.push(
      `Recent WhatsApp and call memory:\n${memory.thread
        .map((line) => `${line.role === 'customer' ? 'Customer' : 'Assistant'}: ${line.text}`)
        .join('\n')}`,
    )
  }
  if (memory.languageHint) {
    parts.push(
      `The customer has been speaking ${memory.languageHint}. Stay in that language unless they switch.`,
    )
  }
  if (parts.length === 0) return ''
  return (
    `\n\nCustomer memory — recall these facts; do not re-ask what they already said.\n` +
    parts.join('\n\n')
  )
}

export function searchLiveAiMemory(
  memory: Pick<LiveAiCustomerMemory, 'notes' | 'thread'> & {
    recall?: LiveAiMemoryLine[]
  },
  query: string,
): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const tokens = q.split(/\s+/).filter((t) => t.length > 1)
  if (tokens.length === 0) return []
  const thread = memory.recall ?? memory.thread
  const rows: { source: string; text: string }[] = [
    ...memory.notes.map((text) => ({ source: 'note', text })),
    ...thread.map((line) => ({
      source: line.role,
      text: line.text,
    })),
  ]
  return rows
    .filter((row) => tokens.some((token) => row.text.toLowerCase().includes(token)))
    .slice(0, 8)
    .map((row) => `${row.source}: ${row.text}`)
}

export async function loadLiveAiCustomerMemory(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  conversationId: string
}): Promise<LiveAiCustomerMemory> {
  const [notesRes, messages] = await Promise.all([
    args.db
      .from('contact_notes')
      .select('note_text')
      .eq('contact_id', args.contactId)
      .eq('account_id', args.accountId)
      .order('created_at', { ascending: false })
      .limit(LIVE_AI_MEMORY_NOTES),
    buildConversationContext(args.db, args.conversationId, LIVE_AI_MEMORY_SEARCH_LIMIT),
  ])

  const notes = ((notesRes.data ?? []) as { note_text?: string | null }[])
    .map((row) => (typeof row.note_text === 'string' ? row.note_text.trim() : ''))
    .filter(Boolean)
  const recall = memoryLinesFromThread(messages)
  const thread = recall.slice(-LIVE_AI_MEMORY_THREAD)
  return {
    notes,
    thread,
    recall,
    languageHint: detectLiveAiLanguageHint(recall),
  }
}
