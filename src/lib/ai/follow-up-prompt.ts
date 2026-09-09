import type { ChatMessage } from './types'
import type { ChatLanguageLock } from './language-lock'

export type FollowUpGeneration = {
  action: 'send' | 'skip'
  message: string
  reason: string
}

export function buildFollowUpSystemPrompt(opts: {
  replyLanguage?: ChatLanguageLock | null
  salesSnapshot?: string | null
  productFacts?: string | null
}): string {
  const language = opts.replyLanguage?.locked
    ? `Write in ${opts.replyLanguage.name} (${opts.replyLanguage.script} script).`
    : 'Match the language the customer was using in the transcript.'
  const snapshot = opts.salesSnapshot?.trim()
  const facts = opts.productFacts?.trim()

  return [
    'You write ONE short WhatsApp follow-up after the customer went silent.',
    language,
    'Refer only to what they actually discussed. Be helpful, not pushy.',
    'Use the current product, budget, and unresolved question from the sales snapshot when present.',
    'When current product facts are present, stay on that product: mention in-stock options, budget, or the unanswered question. Do not invent stock or material.',
    'Do not pitch rejected_products. Do not introduce a new unrelated product.',
    'Do not repeat the whole conversation. Do not invent facts.',
    'Do not claim the customer wants something they never requested.',
    'Do not fabricate urgency, discounts, prices, stock, delivery times, or order status.',
    'Do not mention that this message is automated.',
    'Never send a generic “are you still interested” line. Continue the actual thread: the current product, budget, or unanswered question.',
    'If they already purchased or clearly declined, skip.',
    'If there is no meaningful reason to follow up, skip.',
    snapshot ? snapshot : '',
    facts ? facts : '',
    'Reply with JSON only:',
    '{ "action": "send" | "skip", "message": "...", "reason": "..." }',
    'When action is skip, message may be empty.',
  ].filter(Boolean).join('\n')
}

export function parseFollowUpGeneration(raw: string): FollowUpGeneration {
  const json = extractJsonObject(raw)
  if (!json || typeof json !== 'object') {
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

export function isExplicitFollowUpDecline(text: string | null | undefined): boolean {
  return /^(no|nope|later|not now|വേണ്ട|വേണ്ടാ)[.!?]*$/i.test((text ?? '').trim())
}

export function transcriptText(messages: ChatMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n')
}
