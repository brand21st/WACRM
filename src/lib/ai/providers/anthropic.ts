import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  mergeUsage,
  MAX_TOOL_ROUNDS,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
} from './shared'
import { parseToolArgs } from './openai'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

interface AnthropicResponse {
  content?: AnthropicBlock[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * When tools are provided, runs a short tool loop then returns the
 * final assistant text.
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tools, executeTool, maxTokens } =
    args

  const convo: Record<string, unknown>[] = normalizeForAnthropic(messages).map(
    (m) => ({ role: m.role, content: m.content }),
  )

  const toolDefs =
    tools && tools.length > 0 && executeTool
      ? tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }))
      : null

  let usage = null as ProviderResult['usage']
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const useTools = Boolean(toolDefs) && round < MAX_TOOL_ROUNDS
    const data = await postAnthropic({
      apiKey,
      timeoutMs,
      body: {
        model,
        system: systemPrompt,
        max_tokens: maxTokens ?? MAX_OUTPUT_TOKENS,
        messages: convo,
        ...(useTools ? { tools: toolDefs } : {}),
      },
    })
    usage = mergeUsage(
      usage,
      normalizeUsage({
        prompt: data.usage?.input_tokens,
        completion: data.usage?.output_tokens,
      }),
    )

    const blocks = data.content ?? []
    const toolUses = blocks.filter((b) => b.type === 'tool_use' && b.name && b.id)
    if (useTools && toolUses.length > 0 && executeTool) {
      convo.push({ role: 'assistant', content: blocks })
      const results = []
      for (const block of toolUses) {
        const input =
          block.input && typeof block.input === 'object' ? block.input : parseToolArgs('')
        const result = await executeTool(block.name!, input)
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        })
      }
      convo.push({ role: 'user', content: results })
      continue
    }

    const text = blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim()
    if (!text) {
      throw new AiError('Anthropic returned an empty response.', {
        code: 'empty_response',
      })
    }
    return { text, usage }
  }

  throw new AiError('Anthropic returned an empty response.', {
    code: 'empty_response',
  })
}

async function postAnthropic(args: {
  apiKey: string
  timeoutMs: number
  body: Record<string, unknown>
}): Promise<AnthropicResponse> {
  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': args.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(args.timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) {
    throw await providerHttpError('Anthropic', res)
  }
  return ((await res.json().catch(() => null)) as AnthropicResponse | null) ?? {}
}
