import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import type { ExecuteLlmTool, LlmToolDef } from './providers/shared'
import type { ChatLanguageLock } from './language-lock'
import { latestCustomerText, shouldRewriteSpoken, spokenRewrite } from './spoken-rewrite'
import { hasInformalCustomerAddress } from './customer-address'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
  tools?: LlmToolDef[]
  executeTool?: ExecuteLlmTool
  /** Speakable first name so the spoken rewrite keeps the honorific. */
  customerName?: string | null
  /** Locked reply language — rewrite stays here even if the last turn mixed English. */
  replyLanguage?: ChatLanguageLock | null
  /** Keep model JSON intact (conversation follow-up). */
  skipSpokenRewrite?: boolean
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages, tools, executeTool } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
    tools,
    executeTool,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  const parsed = parseGeneration(result.text, result.usage)
  if (args.skipSpokenRewrite) return parsed
  const customerText = latestCustomerText(messages)
  const language = shouldRewriteSpoken({
    draft: parsed.text,
    handoff: parsed.handoff,
    customerText,
    replyLanguage: args.replyLanguage,
  })
  let text = parsed.text
  if (language) {
    text = await spokenRewrite({
      config,
      draft: text,
      language,
      replyLanguage: args.replyLanguage,
      customerText,
      customerName: args.customerName,
    })
  }
  if (!parsed.handoff && hasInformalCustomerAddress(text)) {
    text = await spokenRewrite({
      config,
      draft: text,
      language,
      replyLanguage: args.replyLanguage,
      customerText,
      customerName: args.customerName,
      fixInformalAddress: true,
    })
  }
  return { ...parsed, text }
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
