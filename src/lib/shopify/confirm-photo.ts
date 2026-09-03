import { aiRequestTimeoutMs } from '@/lib/ai/defaults'
import type { ShopifyProductHit } from './types'

const VISION_MODEL = 'gpt-4o-mini'
const MAX_LISTING_IMAGES = 8

export interface ConfirmCatalogMatchesArgs {
  apiKey: string
  customerImageUrl: string
  candidates: ShopifyProductHit[]
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type LabeledListingImage = {
  product: ShopifyProductHit
  url: string
}

/**
 * Featured image first, then extra angles, labeled by product.
 * Caps total listing images sent to vision.
 */
export function listingImagesForConfirm(
  candidates: ShopifyProductHit[],
  max = MAX_LISTING_IMAGES,
): LabeledListingImage[] {
  const out: LabeledListingImage[] = []
  const seen = new Set<string>()
  const push = (product: ShopifyProductHit, raw?: string | null) => {
    const url = raw?.trim()
    if (!url || seen.has(url) || out.length >= max) return
    seen.add(url)
    out.push({ product, url })
  }
  for (const product of candidates) push(product, product.imageUrl)
  for (const product of candidates) {
    for (const url of product.imageUrls ?? []) push(product, url)
  }
  return out
}

/**
 * Ask vision which catalog listing photos match the customer photo.
 * Returns the subset of `candidates` it picked (never invents ids).
 * Returns `null` on network/API failure so the caller can keep the
 * token-ranked hits instead of blocking the webhook.
 */
export async function confirmCatalogMatchesFromPhoto(
  args: ConfirmCatalogMatchesArgs,
): Promise<ShopifyProductHit[] | null> {
  const listings = listingImagesForConfirm(args.candidates)
  if (listings.length === 0) return null

  const fetchImpl = args.fetchImpl ?? fetch
  const labeled = [...new Map(listings.map((row) => [row.product.id, row.product])).values()]
    .map((p, i) => `${i + 1}. id=${p.id} handle=${p.handle} title=${p.title}`)
    .join('\n')

  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text:
        'Image 1 is a product photo a customer sent on WhatsApp. ' +
        'The following images are Shopify catalog listings (some products have extra angles). ' +
        'Pick the listing(s) that show the SAME product as image 1. ' +
        'Reply with JSON only: {"ids":["<product id>"]}. ' +
        'Use only ids from this list. Pick 1 if clearly the same item, 2 if two are equally likely, or {"ids":[]} if none match.\n' +
        labeled,
    },
    { type: 'image_url', image_url: { url: args.customerImageUrl } },
  ]
  for (const row of listings) {
    content.push({
      type: 'text',
      text: `Next image is a catalog listing for id=${row.product.id} handle=${row.product.handle} title=${row.product.title}.`,
    })
    content.push({ type: 'image_url', image_url: { url: row.url } })
  }

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
        max_completion_tokens: 200,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? aiRequestTimeoutMs()),
    })
  } catch (err) {
    console.warn(
      '[shopify confirm-photo] vision request failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    console.warn(
      '[shopify confirm-photo] vision API error:',
      (body as { error?: { message?: string } })?.error?.message ?? res.status,
    )
    return null
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data?.choices?.[0]?.message?.content?.trim()
  if (!text) return null

  try {
    return pickConfirmedHits(text, args.candidates)
  } catch (err) {
    console.warn('[shopify confirm-photo] parse failed:', err)
    return null
  }
}

/** Exported for unit tests. Never invents products outside `candidates`. */
export function pickConfirmedHits(
  text: string,
  candidates: ShopifyProductHit[],
): ShopifyProductHit[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []
  const parsed = JSON.parse(jsonMatch[0]) as {
    ids?: unknown
    indexes?: unknown
  }
  const byId = new Map(candidates.map((p) => [p.id, p]))
  const byHandle = new Map(candidates.map((p) => [p.handle, p]))
  const out: ShopifyProductHit[] = []
  const seen = new Set<string>()

  const push = (hit: ShopifyProductHit | undefined) => {
    if (!hit || seen.has(hit.id)) return
    seen.add(hit.id)
    out.push(hit)
  }

  if (Array.isArray(parsed.ids)) {
    for (const raw of parsed.ids) {
      const key = String(raw).trim()
      push(byId.get(key) ?? byHandle.get(key))
    }
  }
  if (out.length === 0 && Array.isArray(parsed.indexes)) {
    for (const raw of parsed.indexes) {
      const i = Number(raw)
      if (Number.isInteger(i) && i >= 0 && i < candidates.length) {
        push(candidates[i])
      }
    }
  }
  return out
}
