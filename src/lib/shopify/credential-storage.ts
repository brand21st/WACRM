import { isApiSecretKey } from './oauth'

const OAUTH_PACK_KIND = 'oauth' as const
const INSTALLED_PACK_KIND = 'installed' as const

interface PackedOAuthCredential {
  kind: typeof OAUTH_PACK_KIND
  clientId: string
  secret: string
}

interface PackedInstalledCredential {
  kind: typeof INSTALLED_PACK_KIND
  clientId: string
  accessToken: string
  secret?: string
}

export interface UnpackedShopifyCredential {
  credential: string
  clientId: string | null
  /** Partner API secret (shpss_) for webhook HMAC verification. */
  webhookSecret: string | null
}

/**
 * When the DB has no `client_id` column yet, bundle Client ID with the
 * encrypted secret so catalog sync / auto-reply can still exchange OAuth.
 */
export function packShopifyCredential(
  clientId: string | null | undefined,
  credential: string,
): string {
  const trimmed = credential.trim()
  if (isApiSecretKey(trimmed) && clientId?.trim()) {
    return JSON.stringify({
      kind: OAUTH_PACK_KIND,
      clientId: clientId.trim().slice(0, 128),
      secret: trimmed,
    } satisfies PackedOAuthCredential)
  }
  return trimmed
}

/** Store OAuth access token after install while keeping the API secret for webhooks. */
export function packInstalledShopifyCredential(args: {
  clientId: string
  accessToken: string
  webhookSecret?: string | null
}): string {
  const clientId = args.clientId.trim().slice(0, 128)
  const accessToken = args.accessToken.trim()
  const secret =
    typeof args.webhookSecret === 'string' && args.webhookSecret.trim()
      ? args.webhookSecret.trim()
      : undefined
  return JSON.stringify({
    kind: INSTALLED_PACK_KIND,
    clientId,
    accessToken,
    secret,
  } satisfies PackedInstalledCredential)
}

export function unpackShopifyCredential(plaintext: string): UnpackedShopifyCredential {
  const trimmed = plaintext.trim()
  if (!trimmed.startsWith('{')) {
    return {
      credential: trimmed,
      clientId: null,
      webhookSecret: isApiSecretKey(trimmed) ? trimmed : null,
    }
  }
  try {
    const parsed = JSON.parse(trimmed) as
      | Partial<PackedOAuthCredential>
      | Partial<PackedInstalledCredential>
    if (
      parsed.kind === INSTALLED_PACK_KIND &&
      typeof parsed.clientId === 'string' &&
      parsed.clientId.trim() &&
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken.trim()
    ) {
      const secret =
        typeof parsed.secret === 'string' && parsed.secret.trim()
          ? parsed.secret.trim()
          : null
      return {
        credential: parsed.accessToken.trim(),
        clientId: parsed.clientId.trim().slice(0, 128),
        webhookSecret: secret,
      }
    }
    if (
      parsed.kind === OAUTH_PACK_KIND &&
      typeof parsed.clientId === 'string' &&
      parsed.clientId.trim() &&
      typeof parsed.secret === 'string' &&
      parsed.secret.trim()
    ) {
      const secret = parsed.secret.trim()
      return {
        credential: secret,
        clientId: parsed.clientId.trim().slice(0, 128),
        webhookSecret: secret,
      }
    }
  } catch {
    // Legacy plaintext token — not JSON.
  }
  return { credential: trimmed, clientId: null, webhookSecret: null }
}

export function resolveStoredClientId(
  rowClientId: string | null | undefined,
  unpackedClientId: string | null,
): string | null {
  const fromRow =
    typeof rowClientId === 'string' && rowClientId.trim()
      ? rowClientId.trim().slice(0, 128)
      : null
  return fromRow ?? unpackedClientId
}
