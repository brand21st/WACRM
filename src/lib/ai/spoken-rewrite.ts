import type { AiConfig, ChatMessage } from './types'
import { aiRequestTimeoutMs } from './defaults'
import {
  INDIC_CURRENCY_WORDS,
  INDIC_LANGUAGE_NAMES,
  detectSpokenIndicTarget,
  isIndicScript,
  type IndicLanguageCodes,
} from './indic-language'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

const REWRITE_MAX_TOKENS = 256
const REWRITE_TIMEOUT_MS = 15_000

const ROMANIZED_MIX: Record<string, string> = {
  ml: 'Manglish',
  hi: 'Hinglish',
  ta: 'Tanglish',
  te: 'romanized Telugu',
  kn: 'romanized Kannada',
  mr: 'romanized Marathi',
  as: 'romanized Assamese',
}

export function rewriteScriptStyle(
  customerText?: string | null,
): 'native' | 'romanized' {
  return isIndicScript(customerText) ? 'native' : 'romanized'
}

function rewriteSystemPrompt(
  lang: IndicLanguageCodes,
  customerName?: string | null,
  scriptStyle: 'native' | 'romanized' = 'native',
): string {
  const name = INDIC_LANGUAGE_NAMES[lang.elevenlabs] ?? 'the customer’s Indian language'
  const currency = INDIC_CURRENCY_WORDS[lang.elevenlabs] ?? 'the spoken rupee word'
  const mix = ROMANIZED_MIX[lang.elevenlabs] ?? `romanized ${name}`
  const register =
    scriptStyle === 'romanized'
      ? `spoken everyday ${mix} in Latin letters — do not force ${name} native script`
      : `spoken everyday ${name} in native script, shop-counter tone`
  const address = customerName?.trim()
    ? ` If the draft already uses the customer’s name (${customerName.trim()}) or an honorific, keep it. Do not add ji, sir, madam, or similar if the draft did not use one. Do not switch to textbook «താങ്കൾ».`
    : ' If the draft already uses a name or honorific, keep it. Do not add ji, sir, madam, or similar if the draft did not use one. Do not switch to textbook «താങ്കൾ».'
  const malayalamPair =
    lang.elevenlabs === 'ml'
      ? ' Malayalam stiff «ഇത് നിങ്ങൾക്ക് ലഭ്യമാണ്» / «താങ്കൾക്ക് ഈ ഉൽപ്പന്നം ലഭ്യമാണ്» → spoken «ഇതുണ്ട്, നോക്കിക്കോ» (formal: «ഇതുണ്ട്, നോക്കൂ»).'
      : ''
  return (
    `Rewrite the shop assistant’s WhatsApp draft into ${register}. ` +
    `Fix English word order and calques. Rewrite as a native speaker would say it — do not translate from English; do not polish into textbook grammar.` +
    malayalamPair +
    ` Keep a natural human tone — no “Certainly”, “Absolutely”, or scripted filler. ` +
    `Keep every fact, price, product name, SKU, order id, and URL. Do not add new claims.` +
    address +
    ` Write prices as the amount plus ${currency} — never ₹, Rs, Rs., or INR. ` +
    `Write product names in title case, never ALL-CAPS catalog slugs. ` +
    `Output only the rewritten message text.`
  )
}

export function shouldRewriteSpoken(args: {
  draft: string
  handoff?: boolean
  customerText?: string | null
}): IndicLanguageCodes | null {
  if (args.handoff || !args.draft.trim()) return null
  return detectSpokenIndicTarget(args.customerText)
}

/**
 * Cheap second pass: spoken register + speakable prices/names.
 * On any failure, returns the original draft.
 */
export async function spokenRewrite(args: {
  config: AiConfig
  draft: string
  customerText?: string | null
  language?: IndicLanguageCodes | null
  customerName?: string | null
}): Promise<string> {
  const language =
    args.language ?? detectSpokenIndicTarget(args.customerText)
  const draft = args.draft.trim()
  if (!language || !draft) return args.draft

  const timeoutMs = Math.min(aiRequestTimeoutMs(), REWRITE_TIMEOUT_MS)
  const providerArgs = {
    apiKey: args.config.apiKey,
    model: args.config.model,
    systemPrompt: rewriteSystemPrompt(
      language,
      args.customerName,
      rewriteScriptStyle(args.customerText),
    ),
    messages: [{ role: 'user' as const, content: draft }] satisfies ChatMessage[],
    timeoutMs,
    maxTokens: REWRITE_MAX_TOKENS,
  }

  try {
    const result =
      args.config.provider === 'anthropic'
        ? await generateAnthropic(providerArgs)
        : await generateOpenAi(providerArgs)
    const text = result.text.trim()
    return text || args.draft
  } catch {
    return args.draft
  }
}

export function latestCustomerText(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content.trim()) {
      return messages[i].content
    }
  }
  return null
}
