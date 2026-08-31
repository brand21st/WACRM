export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = 'shopify_error',
  ) {
    super(message)
    this.name = 'ShopifyError'
  }
}

const API_VERSION = '2026-07'
const DEFAULT_TIMEOUT_MS = 20_000

export async function shopifyGraphql<T = Record<string, unknown>>(
  args: {
    shopDomain: string
    accessToken: string
    query: string
    variables?: Record<string, unknown>
    timeoutMs?: number
    fetchImpl?: typeof fetch
  },
): Promise<T> {
  const url = `https://${args.shopDomain}/admin/api/${API_VERSION}/graphql.json`
  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': args.accessToken,
      },
      body: JSON.stringify({
        query: args.query,
        variables: args.variables ?? {},
      }),
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ShopifyError(`Could not reach Shopify: ${msg}`, 504, 'shopify_timeout')
  }

  const body = (await res.json().catch(() => null)) as {
    data?: T
    errors?: { message?: string }[]
  } | null

  if (!res.ok) {
    const detail = body?.errors?.[0]?.message
    const code =
      res.status === 401 || res.status === 403 ? 'invalid_token' : 'shopify_error'
    throw new ShopifyError(
      detail
        ? `Shopify API error (${res.status}): ${detail}`
        : `Shopify API error (${res.status})`,
      res.status === 401 || res.status === 403 ? 401 : 502,
      code,
    )
  }

  if (body?.errors?.length) {
    const detail = body.errors.map((e) => e.message).filter(Boolean).join('; ')
    const unauthorized = /access denied|unauthorized|invalid.*token/i.test(detail)
    throw new ShopifyError(
      detail || 'Shopify GraphQL error.',
      unauthorized ? 401 : 502,
      unauthorized ? 'invalid_token' : 'shopify_error',
    )
  }

  if (!body?.data) {
    throw new ShopifyError('Shopify returned an empty response.')
  }
  return body.data as T
}

export async function shopifyRest<T = Record<string, unknown>>(
  args: {
    shopDomain: string
    accessToken: string
    path: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
    body?: Record<string, unknown>
    timeoutMs?: number
    fetchImpl?: typeof fetch
  },
): Promise<T> {
  const path = args.path.startsWith('/') ? args.path : `/${args.path}`
  const url = `https://${args.shopDomain}/admin/api/${API_VERSION}${path}`
  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(url, {
      method: args.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': args.accessToken,
      },
      body: args.body ? JSON.stringify(args.body) : undefined,
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ShopifyError(`Could not reach Shopify: ${msg}`, 504, 'shopify_timeout')
  }

  const rawText = await res.text().catch(() => '')
  let body: T | null = null
  if (rawText) {
    try {
      body = JSON.parse(rawText) as T
    } catch {
      body = null
    }
  }

  if (!res.ok) {
    const detail =
      typeof body === 'object' &&
      body &&
      'errors' in body &&
      typeof (body as { errors?: string }).errors === 'string'
        ? (body as { errors: string }).errors
        : rawText.slice(0, 200)
    const code =
      res.status === 401 || res.status === 403 ? 'invalid_token' : 'shopify_error'
    throw new ShopifyError(
      detail
        ? `Shopify API error (${res.status}): ${detail}`
        : `Shopify API error (${res.status})`,
      res.status === 401 || res.status === 403 ? 401 : 502,
      code,
    )
  }

  return (body ?? {}) as T
}
