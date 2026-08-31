import { AiError, type AiProvider } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'

/** Cheap vision model for inbound image understanding. */
const VISION_MODEL = 'gpt-4o-mini'

export const PRODUCT_PHOTO_PLACEHOLDER = '[Customer sent a product photo]'
export const IMAGE_PLACEHOLDER = '[Customer sent an image]'

export interface DescribeInboundImageArgs {
  provider: AiProvider
  apiKey: string
  /** Public HTTPS URL, Meta CDN, or relative `/api/whatsapp/media/...` proxy. */
  mediaUrl: string | null
  caption: string | null
  timeoutMs?: number
  fetchImpl?: typeof fetch
  /** `shopping` extracts catalog search terms from a product photo. */
  purpose?: 'support' | 'shopping'
  /** Meta media id — used to download bytes when the URL is not public. */
  mediaId?: string | null
  /** WhatsApp Cloud API token for `getMediaUrl` / `downloadMedia`. */
  accessToken?: string | null
  getMediaUrlImpl?: typeof getMediaUrl
  downloadMediaImpl?: typeof downloadMedia
}

/**
 * Turn an inbound WhatsApp image into text the LLM can read. Uses
 * OpenAI vision when the account is on OpenAI and we can give it a
 * public URL or a data-URL of the bytes. Never throws — a failed
 * describe must not block the webhook.
 */
export async function describeInboundImage(
  args: DescribeInboundImageArgs,
): Promise<string | null> {
  const caption = args.caption?.trim() || ''
  const purpose = args.purpose ?? 'support'

  if (args.provider === 'openai') {
    try {
      const imageUrl = await resolveVisionImageUrl(args)
      if (imageUrl) {
        const description = await visionDescribe({
          apiKey: args.apiKey,
          imageUrl,
          caption,
          timeoutMs: args.timeoutMs,
          fetchImpl: args.fetchImpl,
          purpose,
        })
        if (description) return description
      }
    } catch (err) {
      console.error('[ai vision] describe failed:', err)
    }
  }

  if (caption) return caption
  if (purpose === 'shopping') return PRODUCT_PHOTO_PLACEHOLDER
  const url = args.mediaUrl?.trim() || ''
  if (url.startsWith('https://') || args.mediaId) return IMAGE_PLACEHOLDER
  return null
}

export async function resolveVisionImageUrl(
  args: DescribeInboundImageArgs,
): Promise<string | null> {
  const url = args.mediaUrl?.trim() || ''
  if (url.startsWith('https://')) return url

  const mediaId = args.mediaId?.trim()
  const accessToken = args.accessToken?.trim()
  if (!mediaId || !accessToken) return null

  const getUrl = args.getMediaUrlImpl ?? getMediaUrl
  const download = args.downloadMediaImpl ?? downloadMedia
  const info = await getUrl({ mediaId, accessToken })
  const { buffer, contentType } = await download({
    downloadUrl: info.url,
    accessToken,
  })
  const mime = (contentType.split(';')[0] || info.mimeType || 'image/jpeg').trim()
  return `data:${mime};base64,${buffer.toString('base64')}`
}

async function visionDescribe(args: {
  apiKey: string
  imageUrl: string
  caption: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  purpose: 'support' | 'shopping'
}): Promise<string | null> {
  const fetchImpl = args.fetchImpl ?? fetch
  const prompt = shoppingOrSupportPrompt(args.purpose, args.caption)

  let res: Response
  try {
    res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_completion_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: args.imageUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? aiRequestTimeoutMs()),
    })
  } catch (err) {
    throw new AiError(
      err instanceof Error ? err.message : 'Vision request failed.',
      { code: 'vision_network', status: 502 },
    )
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new AiError(
      (body as { error?: { message?: string } })?.error?.message ??
        `Vision API error: ${res.status}`,
      { code: 'vision_error', status: res.status },
    )
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data?.choices?.[0]?.message?.content?.trim()
  return text || null
}

export function shoppingOrSupportPrompt(
  purpose: 'support' | 'shopping',
  caption: string,
): string {
  if (purpose === 'shopping') {
    const extra = caption
      ? ` The customer also wrote: "${caption}".`
      : ''
    return (
      'This is a product photo a customer sent on WhatsApp.' +
      extra +
      ' List searchable attributes only: item type, color, brand or logo, pattern, material, and any visible text or SKU. One or two sentences, no fluff.'
    )
  }
  return caption
    ? `The customer sent this WhatsApp image with caption: "${caption}". Briefly describe what you see in one or two sentences, then note the caption.`
    : 'The customer sent this WhatsApp image. Briefly describe what you see in one or two sentences so a support agent can reply helpfully.'
}
