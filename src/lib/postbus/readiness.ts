import type { SupabaseClient } from '@supabase/supabase-js'

import { hasScope } from '@/lib/api-keys/scopes'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

import type { PostBusApprovedTemplate } from './config'

export async function accountHasWhatsAppConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('phone_number_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return Boolean(data?.phone_number_id)
}

export async function accountHasSendApiKey(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('api_keys')
    .select('scopes, revoked_at, expires_at')
    .eq('account_id', accountId)
  if (error) throw error
  const now = Date.now()
  return (data ?? []).some((row) => {
    if (row.revoked_at) return false
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) return false
    const scopes = (row.scopes as string[]) ?? []
    return (
      hasScope(scopes, 'messages:send') || hasScope(scopes, 'postbus:send')
    )
  })
}

export async function listApprovedTemplates(
  db: SupabaseClient,
  accountId: string,
): Promise<PostBusApprovedTemplate[]> {
  const { data, error } = await db
    .from('message_templates')
    .select('name, language, status')
    .eq('account_id', accountId)
    .in('status', ['APPROVED', 'Approved'])
    .order('name')
  if (error) throw error
  return (data ?? [])
    .filter((row) => typeof row.name === 'string' && row.name.trim())
    .map((row) => ({
      name: row.name as string,
      language: (row.language as string) || 'en_US',
      status: String(row.status),
    }))
}

export async function officialWhatsAppIdentity(
  db: SupabaseClient,
  accountId: string,
): Promise<{
  account_id: string
  display_phone: string | null
  verified_name: string | null
  connected: boolean
}> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.phone_number_id || !data.access_token) {
    return {
      account_id: accountId,
      display_phone: null,
      verified_name: null,
      connected: false,
    }
  }
  try {
    const info = await verifyPhoneNumber({
      phoneNumberId: data.phone_number_id,
      accessToken: decrypt(data.access_token),
    })
    return {
      account_id: accountId,
      display_phone: info.display_phone_number ?? null,
      verified_name: info.verified_name ?? null,
      connected: true,
    }
  } catch {
    return {
      account_id: accountId,
      display_phone: null,
      verified_name: null,
      connected: true,
    }
  }
}

export async function probeWhatsAppPhone(
  db: SupabaseClient,
  accountId: string,
): Promise<'ok' | 'missing' | 'error'> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) return 'error'
  if (!data?.phone_number_id || !data.access_token) return 'missing'
  try {
    const token = decrypt(data.access_token)
    await verifyPhoneNumber({
      phoneNumberId: data.phone_number_id,
      accessToken: token,
    })
    return 'ok'
  } catch {
    return 'error'
  }
}
