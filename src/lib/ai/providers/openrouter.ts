import { AiError, type ProviderResult } from '../types'
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

// OpenRouter is OpenAI-compatible but uses its own base URL and requires
// two extra headers for routing analytics.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://wacrm.app'
const APP_TITLE = 'WACRM'

interface OpenRouterToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface OpenRouterResponse {
  choices?: {
    message?: {
      role?: string
      content?: string | null
      tool_calls?: OpenRouterToolCall[]
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Call OpenRouter's OpenAI-compatible Chat Completions endpoint.
 * OpenRouter is a proxy to 200+ models; the caller sets the model ID
 * (e.g. "openai/gpt-4o-mini") in `args.model`.
 * Required extra headers: HTTP-Referer, X-Title.
 */
export async function generateOpenRouter(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tools, executeTool, maxTokens } =
    args

  const openrouterMessages: Record<string, unknown>[] = [
    { role: 'system', content: systemPrompt },
    ...mergeConsecutive(messages).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ]

  const toolDefs =
    tools && tools.length > 0 && executeTool
      ? tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : null

  let usage = null as ProviderResult['usage']
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const useTools = Boolean(toolDefs) && round < MAX_TOOL_ROUNDS
    const data = await postOpenRouter({
      apiKey,
      model,
      timeoutMs,
      body: {
        model,
        messages: openrouterMessages,
        max_tokens: maxTokens ?? MAX_OUTPUT_TOKENS,
        ...(useTools ? { tools: toolDefs } : {}),
      },
    })
    usage = mergeUsage(
      usage,
      normalizeUsage({
        prompt: data.usage?.prompt_tokens,
        completion: data.usage?.completion_tokens,
        total: data.usage?.total_tokens,
      }),
    )

    const msg = data.choices?.[0]?.message
    const toolCalls = msg?.tool_calls?.filter((c) => c.function?.name) ?? []
    if (useTools && toolCalls.length > 0 && executeTool) {
      openrouterMessages.push({
        role: 'assistant',
        content: msg?.content ?? null,
        tool_calls: toolCalls,
      })
      for (const call of toolCalls) {
        const result = await executeTool(
          call.function!.name!,
          parseOpenRouterToolArgs(call.function?.arguments),
        )
        openrouterMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        })
      }
      continue
    }

    const text = typeof msg?.content === 'string' ? msg.content.trim() : ''
    if (!text) {
      throw new AiError('OpenRouter returned an empty response.', {
        code: 'empty_response',
      })
    }
    return { text, usage }
  }

  throw new AiError('OpenRouter returned an empty response.', {
    code: 'empty_response',
  })
}

async function postOpenRouter(args: {
  apiKey: string
  model: string
  timeoutMs: number
  body: Record<string, unknown>
}): Promise<OpenRouterResponse> {
  let res: Response
  try {
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
        // Required by OpenRouter for usage attribution and dashboard tracking.
        'HTTP-Referer': APP_URL,
        'X-Title': APP_TITLE,
      },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(args.timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) {
    throw await providerHttpError('OpenRouter', res)
  }
  return ((await res.json().catch(() => null)) as OpenRouterResponse | null) ?? {}
}

export function parseOpenRouterToolArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}') as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
  } catch {
    // malformed JSON from the model
  }
  return {}
}
