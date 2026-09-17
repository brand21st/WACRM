import { createClient as createAdminClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'
import {
  exchangeLoginCode,
  extendUserToken,
  getPageInstagramAccount,
  getPageToken,
  listUserPages,
  subscribePageApps,
} from '@/lib/meta/graph'
import { encrypt } from '@/lib/whatsapp/encryption'
import { invalidateWebhookAppSecretsCache } from '@/lib/whatsapp/webhook-app-secrets'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function supabaseAdmin() {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export class MetaConnectError extends Error {
  readonly status: number
  readonly code: string
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'MetaConnectError'
    this.code = code
    this.status = status
  }
}

export interface PersistPageConnectionInput {
  accountId: string
  userId: string
  pageId: string
  pageAccessToken: string
  onboardingSource: 'facebook_login' | 'manual'
  verifyToken?: string | null
  metaAppId?: string | null
  metaAppSecret?: string | null
  tokenExpiresAt?: string | null
}

export interface PersistPageConnectionResult {
  pageId: string
  pageName: string | null
  igUsername: string | null
  messengerStatus: 'connected' | 'disconnected'
  instagramStatus: 'connected' | 'disconnected'
  subscribedAppsAt: string | null
  lastError: string | null
}

export async function persistPageConnection(
  input: PersistPageConnectionInput,
): Promise<PersistPageConnectionResult> {
  const db = supabaseAdmin()
  const { data: claimed, error: claimedError } = await db
    .from('meta_page_connections')
    .select('account_id')
    .eq('page_id', input.pageId)
    .neq('account_id', input.accountId)
    .maybeSingle()

  if (claimedError && !/invalid api key/i.test(claimedError.message ?? '')) {
    throw new MetaConnectError('db_error', 'Failed to validate the Facebook Page', 500)
  }
  if (claimed) {
    throw new MetaConnectError(
      'page_in_use',
      'This Facebook Page is already connected to another Vachat account.',
      409,
    )
  }

  const pageInfo = await getPageInstagramAccount({
    pageId: input.pageId,
    pageAccessToken: input.pageAccessToken,
  })

  const encrypted = encrypt(input.pageAccessToken)
  const encryptedSecret = input.metaAppSecret
    ? encrypt(input.metaAppSecret)
    : null
  const now = new Date().toISOString()
  const row = {
    account_id: input.accountId,
    user_id: input.userId,
    page_id: pageInfo.pageId,
    page_name: pageInfo.pageName,
    ig_user_id: pageInfo.igUserId,
    ig_username: pageInfo.igUsername,
    access_token: encrypted,
    verify_token: input.verifyToken ?? null,
    token_expires_at: input.tokenExpiresAt ?? null,
    messenger_status: 'connected' as const,
    instagram_status: pageInfo.igUserId ? ('connected' as const) : ('disconnected' as const),
    connected_at: now,
    onboarding_source: input.onboardingSource,
    last_error: null,
    meta_app_id: input.metaAppId ?? null,
    meta_app_secret: encryptedSecret,
    updated_at: now,
  }

  const { error: upsertError } = await db
    .from('meta_page_connections')
    .upsert(row, { onConflict: 'account_id' })
  if (upsertError) {
    if (isUniqueViolation(upsertError)) {
      throw new MetaConnectError(
        'page_in_use',
        'This Facebook Page is already connected to another Vachat account.',
        409,
      )
    }
    throw new MetaConnectError('db_error', 'Failed to save the connection', 500)
  }

  invalidateWebhookAppSecretsCache()

  let subscribedAppsAt: string | null = null
  let lastError: string | null = null
  try {
    await subscribePageApps({
      pageId: pageInfo.pageId,
      pageAccessToken: input.pageAccessToken,
    })
    subscribedAppsAt = new Date().toISOString()
    await db
      .from('meta_page_connections')
      .update({ subscribed_apps_at: subscribedAppsAt, last_error: null })
      .eq('account_id', input.accountId)
  } catch (err) {
    lastError = err instanceof Error ? err.message : 'Failed to subscribe webhooks'
    console.error('[meta/connect] subscribed_apps failed:', lastError)
    await db
      .from('meta_page_connections')
      .update({ last_error: lastError })
      .eq('account_id', input.accountId)
  }

  return {
    pageId: pageInfo.pageId,
    pageName: pageInfo.pageName,
    igUsername: pageInfo.igUsername,
    messengerStatus: 'connected',
    instagramStatus: pageInfo.igUserId ? 'connected' : 'disconnected',
    subscribedAppsAt,
    lastError,
  }
}

export async function connectFromFacebookCode(args: {
  accountId: string
  userId: string
  code: string
  redirectUri?: string
  pageId?: string
}): Promise<PersistPageConnectionResult> {
  const exchanged = await exchangeLoginCode({
    code: args.code,
    redirectUri: args.redirectUri,
  })
  let userToken = exchanged.accessToken
  try {
    const extended = await extendUserToken({ shortLivedToken: userToken })
    userToken = extended.accessToken
  } catch (err) {
    console.warn(
      '[meta/connect] extend user token failed, using short-lived token:',
      err instanceof Error ? err.message : err,
    )
  }

  return persistFromUserToken({
    accountId: args.accountId,
    userId: args.userId,
    userAccessToken: userToken,
    pageId: args.pageId,
  })
}

export async function connectFromUserToken(args: {
  accountId: string
  userId: string
  userAccessToken: string
  pageId?: string
}): Promise<PersistPageConnectionResult> {
  let userToken = args.userAccessToken.trim()
  if (!userToken) {
    throw new MetaConnectError('bad_request', 'Facebook Login did not return a token', 400)
  }
  try {
    const extended = await extendUserToken({ shortLivedToken: userToken })
    userToken = extended.accessToken
  } catch (err) {
    console.warn(
      '[meta/connect] extend user token failed, using short-lived token:',
      err instanceof Error ? err.message : err,
    )
  }
  return persistFromUserToken({
    accountId: args.accountId,
    userId: args.userId,
    userAccessToken: userToken,
    pageId: args.pageId,
  })
}

async function persistFromUserToken(args: {
  accountId: string
  userId: string
  userAccessToken: string
  pageId?: string
}): Promise<PersistPageConnectionResult> {
  const pages = await listUserPages({ userAccessToken: args.userAccessToken })
  if (pages.length === 0) {
    throw new MetaConnectError(
      'no_pages',
      'No Facebook Pages were available. Choose a Page you can manage messages for.',
      400,
    )
  }
  const selected =
    (args.pageId ? pages.find((p) => p.id === args.pageId) : null) ?? pages[0]
  const pageToken = selected.access_token
    ? { pageId: selected.id, accessToken: selected.access_token }
    : await getPageToken({
        pageId: selected.id,
        userAccessToken: args.userAccessToken,
      })

  return persistPageConnection({
    accountId: args.accountId,
    userId: args.userId,
    pageId: pageToken.pageId,
    pageAccessToken: pageToken.accessToken,
    onboardingSource: 'facebook_login',
  })
}

export async function connectFromManualToken(args: {
  accountId: string
  userId: string
  pageId: string
  pageAccessToken: string
  verifyToken?: string | null
}): Promise<PersistPageConnectionResult> {
  return persistPageConnection({
    accountId: args.accountId,
    userId: args.userId,
    pageId: args.pageId.trim(),
    pageAccessToken: args.pageAccessToken.trim(),
    onboardingSource: 'manual',
    verifyToken: args.verifyToken ?? null,
  })
}

export { resolveFacebookLoginConfig } from '@/lib/meta/platform-settings'
