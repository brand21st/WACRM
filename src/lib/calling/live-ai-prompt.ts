export const LIVE_AI_PROMPT_MAX = 4000

export type LiveAiPromptParse =
  | { ok: true; value: string | null }
  | { ok: false }

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

/** Empty or missing → null. Over LIVE_AI_PROMPT_MAX or non-string → not ok. */
export function parseLiveAiPromptField(value: unknown): LiveAiPromptParse {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (trimmed.length > LIVE_AI_PROMPT_MAX) return { ok: false }
  return { ok: true, value: trimmed }
}

export function normalizeLiveAiPromptField(value: unknown): string | null {
  return trimOrNull(typeof value === 'string' ? value : null)
}

/**
 * Call-only prompt for the live voice agent.
 * Any filled field replaces the chat system prompt; all empty → chat fallback.
 */
export function liveAiCallUserPrompt(args: {
  behaviour: string | null | undefined
  businessContext: string | null | undefined
  instructions: string | null | undefined
  chatPrompt: string | null | undefined
}): string | null {
  const behaviour = trimOrNull(args.behaviour)
  const businessContext = trimOrNull(args.businessContext)
  const instructions = trimOrNull(args.instructions)
  const parts: string[] = []
  if (behaviour) parts.push(`Call behaviour:\n${behaviour}`)
  if (businessContext) parts.push(`Business context:\n${businessContext}`)
  if (instructions) parts.push(`Call instructions:\n${instructions}`)
  if (parts.length > 0) return parts.join('\n\n')
  return trimOrNull(args.chatPrompt)
}
