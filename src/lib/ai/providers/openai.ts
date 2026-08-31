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

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface OpenAiResponse {
  choices?: {
    message?: {
      role?: string
      content?: string | null
      tool_calls?: OpenAiToolCall[]
    }
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * Call OpenAI's Chat Completions endpoint with the caller's own key.
 * When tools are provided, runs a short tool loop then returns the
 * final assistant text.
 */
export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tools, executeTool, maxTokens } =
    args

  const openaiMessages: Record<string, unknown>[] = [
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
    const data = await postOpenAi({
      apiKey,
      model,
      timeoutMs,
      body: {
        model,
        messages: openaiMessages,
        max_completion_tokens: maxTokens ?? MAX_OUTPUT_TOKENS,
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
      openaiMessages.push({
        role: 'assistant',
        content: msg?.content ?? null,
        tool_calls: toolCalls,
      })
      for (const call of toolCalls) {
        const result = await executeTool(
          call.function!.name!,
          parseToolArgs(call.function?.arguments),
        )
        openaiMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        })
      }
      continue
    }

    const text = typeof msg?.content === 'string' ? msg.content.trim() : ''
    if (!text) {
      throw new AiError('OpenAI returned an empty response.', {
        code: 'empty_response',
      })
    }
    return { text, usage }
  }

  throw new AiError('OpenAI returned an empty response.', {
    code: 'empty_response',
  })
}

async function postOpenAi(args: {
  apiKey: string
  model: string
  timeoutMs: number
  body: Record<string, unknown>
}): Promise<OpenAiResponse> {
  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(args.timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) {
    throw await providerHttpError('OpenAI', res)
  }
  return ((await res.json().catch(() => null)) as OpenAiResponse | null) ?? {}
}

export function parseToolArgs(raw: string | undefined): Record<string, unknown> {
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
