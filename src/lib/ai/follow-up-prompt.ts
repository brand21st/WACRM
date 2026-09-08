import type { ChatMessage } from './types'
import type { ChatLanguageLock } from './language-lock'

export type FollowUpGeneration = {
  action: 'send' | 'skip'
  message: string
  reason: string
}

export function buildFollowUpSystemPrompt(opts: {
  replyLanguage?: ChatLanguageLock | null
}): string {
  const language = opts.replyLanguage?.locked
    ? `Write in ${opts.replyLanguage.name} (${opts.replyLanguage.script} script).`
    : 'Match the language the customer was using in the transcript.'

  return [
    'You write ONE short WhatsApp follow-up after the customer went silent.',
    language,
    'Look at the latest unanswered assistant question or next step — that is the follow-up topic.',
    'Prefer action send when they were asked something (size, colour, product, address) and did not answer.',
    'An earlier "no" or "later" does not cancel a later question they then continued with.',
    'Refer only to what they actually discussed. Be helpful, not pushy.',
    'Do not repeat the whole conversation. Do not invent facts.',
    'Do not introduce a new unrelated product.',
    'Do not claim the customer wants something they never requested.',
    'Do not fabricate urgency, discounts, prices, stock, delivery times, or order status.',
    'Do not mention that this message is automated.',
    'Do not use generic sales lines like "are you still interested" unless that is exactly what the thread needs.',
    'Skip only when they clearly declined, said they are done, or there is nothing useful to add.',
    'Reply with JSON only:',
    '{ "action": "send" | "skip", "message": "...", "reason": "..." }',
    'When action is skip, message may be empty.',
  ].join('\n')
}

export function parseFollowUpGeneration(raw: string): FollowUpGeneration {
  const json = extractJsonObject(raw)
  if (!json || typeof json !== 'object') {
    const message = raw.trim()
    // Models often ignore JSON and write the WhatsApp line directly.
    if (looksLikePlainFollowUp(message)) {
      return { action: 'send', message, reason: 'plain_text' }
    }
    return { action: 'skip', message: '', reason: 'unparseable' }
  }
  const row = json as Record<string, unknown>
  const action = row.action === 'send' ? 'send' : 'skip'
  const message = typeof row.message === 'string' ? row.message.trim() : ''
  const reason = typeof row.reason === 'string' ? row.reason.trim() : ''
  if (action === 'send' && !message) {
    return { action: 'skip', message: '', reason: reason || 'empty_message' }
  }
  return { action, message, reason }
}

function looksLikePlainFollowUp(text: string): boolean {
  if (text.length < 8) return false
  if (text.startsWith('{')) return false
  if (/^```/.test(text)) return false
  if (/\baction\s*[:=]\s*["']?skip\b/i.test(text)) return false
  return true
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? trimmed).trim()
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export function hasMeaningfulFollowUpContext(messages: ChatMessage[]): boolean {
  const userTexts = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content.trim())
    .filter(Boolean)
  if (userTexts.length === 0) return false
  const greetingOnly = /^(hi|hii|hello|hey|ok|okay|thanks|thank you|hai|ഹായ്)\.?$/i
  return userTexts.some((text) => {
    if (greetingOnly.test(text)) return false
    if (text.length >= 12) return true
    return /\d/.test(text) || /saree|kurti|dress|size|color|budget|₹|rs\b|inr/i.test(text)
  })
}

export function followUpMentionsUngroundedFacts(
  message: string,
  context: string,
): boolean {
  const ctx = context.toLowerCase()
  const tokens = message.match(/(?:₹|rs\.?|inr)\s*[\d,]+|\b\d{3,}\b/gi) ?? []
  for (const token of tokens) {
    const digits = token.replace(/\D/g, '')
    if (digits.length >= 3 && !ctx.includes(digits)) return true
  }
  return false
}

export function transcriptText(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n')
}
