import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import type { ChannelType } from '@/types'

export type ResolvedTransport =
  | {
      channel: 'whatsapp'
      contactId: string
      phone: string
      phoneNumberId: string
      accessToken: string
    }
  | {
      channel: 'messenger' | 'instagram'
      contactId: string
      recipientId: string
      pageId: string
      accessToken: string
    }

export async function resolveTransport(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<ResolvedTransport> {
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone, channel, channel_user_id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact) {
    throw new Error('contact not found for this account')
  }

  const channel = (contact.channel ?? 'whatsapp') as ChannelType
  if (channel === 'messenger' || channel === 'instagram') {
    const recipientId = String(contact.channel_user_id ?? '').trim()
    if (!recipientId) {
      throw new Error('contact is missing a Messenger or Instagram id')
    }
    const { data: page, error: pageErr } = await db
      .from('meta_page_connections')
      .select('page_id, access_token, messenger_status, instagram_status')
      .eq('account_id', accountId)
      .maybeSingle()
    if (pageErr || !page?.page_id || !page.access_token) {
      throw new Error('Instagram and Messenger are not connected for this account')
    }
    const status =
      channel === 'instagram' ? page.instagram_status : page.messenger_status
    if (status !== 'connected') {
      throw new Error(
        channel === 'instagram'
          ? 'Instagram is not connected for this account'
          : 'Messenger is not connected for this account',
      )
    }
    return {
      channel,
      contactId: contact.id,
      recipientId,
      pageId: page.page_id,
      accessToken: decrypt(page.access_token),
    }
  }

  if (!contact.phone) {
    throw new Error('contact not found for this account')
  }
  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }
  return {
    channel: 'whatsapp',
    contactId: contact.id,
    phone: contact.phone,
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
  }
}

export async function loadPageConnection(
  db: SupabaseClient,
  accountId: string,
): Promise<{
  pageId: string
  accessToken: string
  igUserId: string | null
  messengerStatus: string
  instagramStatus: string
} | null> {
  const { data } = await db
    .from('meta_page_connections')
    .select(
      'page_id, access_token, ig_user_id, messenger_status, instagram_status',
    )
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data?.page_id || !data.access_token) return null
  return {
    pageId: data.page_id,
    accessToken: decrypt(data.access_token),
    igUserId: data.ig_user_id ?? null,
    messengerStatus: data.messenger_status,
    instagramStatus: data.instagram_status,
  }
}
