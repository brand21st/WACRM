import { resolveFacebookLoginConfig } from '@/lib/meta/platform-settings'
import { MetaApiError } from '@/lib/whatsapp/meta-api'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export { MetaApiError, META_API_VERSION, META_API_BASE }

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code: number | undefined
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
    if (typeof data.error?.code === 'number') code = data.error.code
  } catch {
    // keep fallback
  }
  throw new MetaApiError(message, { code, httpStatus: response.status })
}

async function facebookAppCredentials() {
  const cfg = await resolveFacebookLoginConfig()
  if (!cfg.appId || !cfg.appSecret) {
    throw new MetaApiError('Facebook Login is not configured', { httpStatus: 500 })
  }
  return { appId: cfg.appId, appSecret: cfg.appSecret }
}

export async function exchangeLoginCode(args: {
  code: string
  redirectUri?: string
}): Promise<{ accessToken: string; expiresIn?: number }> {
  const { appId, appSecret } = await facebookAppCredentials()
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code: args.code,
  })
  if (args.redirectUri) params.set('redirect_uri', args.redirectUri)
  const url = `${META_API_BASE}/oauth/access_token?${params.toString()}`
  const response = await fetch(url)
  if (!response.ok) await throwMetaError(response, 'Failed to exchange login code')
  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!data.access_token) {
    throw new MetaApiError('Facebook Login did not return a token', { httpStatus: 502 })
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export async function extendUserToken(args: {
  shortLivedToken: string
}): Promise<{ accessToken: string; expiresIn?: number }> {
  const { appId, appSecret } = await facebookAppCredentials()
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: args.shortLivedToken,
  })
  const url = `${META_API_BASE}/oauth/access_token?${params.toString()}`
  const response = await fetch(url)
  if (!response.ok) await throwMetaError(response, 'Failed to extend user token')
  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!data.access_token) {
    throw new MetaApiError('Could not extend the Facebook token', { httpStatus: 502 })
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export interface FacebookPageSummary {
  id: string
  name: string
  access_token?: string
  tasks?: string[]
}

export async function listUserPages(args: {
  userAccessToken: string
}): Promise<FacebookPageSummary[]> {
  const url = `${META_API_BASE}/me/accounts?fields=id,name,access_token,tasks&limit=100`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.userAccessToken}` },
  })
  if (!response.ok) await throwMetaError(response, 'Failed to list Facebook Pages')
  const data = (await response.json()) as { data?: FacebookPageSummary[] }
  return data.data ?? []
}

export async function getPageToken(args: {
  pageId: string
  userAccessToken: string
}): Promise<{ pageId: string; accessToken: string }> {
  const url = `${META_API_BASE}/${encodeURIComponent(args.pageId)}?fields=access_token,id`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.userAccessToken}` },
  })
  if (!response.ok) await throwMetaError(response, 'Failed to load the Page token')
  const data = (await response.json()) as { id?: string; access_token?: string }
  if (!data.access_token || !data.id) {
    throw new MetaApiError('This Page did not return a token', { httpStatus: 502 })
  }
  return { pageId: data.id, accessToken: data.access_token }
}

export async function getPageInstagramAccount(args: {
  pageId: string
  pageAccessToken: string
}): Promise<{
  pageId: string
  pageName: string | null
  igUserId: string | null
  igUsername: string | null
}> {
  const fields =
    'id,name,instagram_business_account{id,username,name}'
  const url = `${META_API_BASE}/${encodeURIComponent(args.pageId)}?fields=${fields}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.pageAccessToken}` },
  })
  if (!response.ok) await throwMetaError(response, 'Failed to load the Facebook Page')
  const data = (await response.json()) as {
    id?: string
    name?: string
    instagram_business_account?: { id?: string; username?: string }
  }
  return {
    pageId: data.id ?? args.pageId,
    pageName: data.name ?? null,
    igUserId: data.instagram_business_account?.id ?? null,
    igUsername: data.instagram_business_account?.username ?? null,
  }
}

const PAGE_SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_deliveries',
  'message_reads',
  'message_echoes',
  'message_reactions',
  'messaging_referrals',
  'messaging_seen',
].join(',')

export async function subscribePageApps(args: {
  pageId: string
  pageAccessToken: string
}): Promise<void> {
  const url = `${META_API_BASE}/${encodeURIComponent(args.pageId)}/subscribed_apps`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.pageAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscribed_fields: PAGE_SUBSCRIBED_FIELDS }),
  })
  if (!response.ok) await throwMetaError(response, 'Failed to subscribe the Page to webhooks')
}

export async function getUserProfile(args: {
  scopedId: string
  pageAccessToken: string
  platform?: 'messenger' | 'instagram'
}): Promise<{ name: string | null; profilePic: string | null }> {
  const fields =
    args.platform === 'instagram'
      ? 'name,username,profile_pic'
      : 'first_name,last_name,name,profile_pic'
  const url = `${META_API_BASE}/${encodeURIComponent(args.scopedId)}?fields=${fields}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.pageAccessToken}` },
  })
  if (!response.ok) return { name: null, profilePic: null }
  const data = (await response.json()) as {
    name?: string
    username?: string
    first_name?: string
    last_name?: string
    profile_pic?: string
  }
  const name =
    data.name ||
    data.username ||
    [data.first_name, data.last_name].filter(Boolean).join(' ') ||
    null
  return { name, profilePic: data.profile_pic ?? null }
}

export interface PageSendResult {
  messageId: string
  recipientId?: string
}

export async function sendPageMessage(args: {
  pageId: string
  pageAccessToken: string
  recipientId: string
  message: Record<string, unknown>
  messagingType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG'
  replyToMid?: string
}): Promise<PageSendResult> {
  const body: Record<string, unknown> = {
    recipient: { id: args.recipientId },
    messaging_type: args.messagingType ?? 'RESPONSE',
    message: args.message,
  }
  if (args.replyToMid) {
    body.reply_to = { mid: args.replyToMid }
  }
  const url = `${META_API_BASE}/${encodeURIComponent(args.pageId)}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.pageAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) await throwMetaError(response, 'Failed to send the message')
  const data = (await response.json()) as {
    message_id?: string
    recipient_id?: string
  }
  if (!data.message_id) {
    throw new MetaApiError('Send succeeded without a message id', { httpStatus: 502 })
  }
  return { messageId: data.message_id, recipientId: data.recipient_id }
}

export async function sendPageSenderAction(args: {
  pageId: string
  pageAccessToken: string
  recipientId: string
  senderAction: 'typing_on' | 'typing_off' | 'mark_seen'
}): Promise<void> {
  const url = `${META_API_BASE}/${encodeURIComponent(args.pageId)}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.pageAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: args.recipientId },
      sender_action: args.senderAction,
    }),
  })
  if (!response.ok) await throwMetaError(response, 'Failed to send typing indicator')
}
