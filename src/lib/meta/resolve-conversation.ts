import type { SupabaseClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts'
import { SendMessageError } from '@/lib/whatsapp/send-message'
import type { ChannelType } from '@/types'

export interface ResolvedChannelConversation {
  conversationId: string
  contactId: string
  contactCreated: boolean
}

export async function resolveConversationByChannelUser(args: {
  db: SupabaseClient
  accountId: string
  channel: Exclude<ChannelType, 'whatsapp'>
  channelUserId: string
  name?: string | null
  avatarUrl?: string | null
}): Promise<ResolvedChannelConversation> {
  const { db, accountId, channel, channelUserId } = args
  const scopedId = channelUserId.trim()
  if (!scopedId) {
    throw new SendMessageError('bad_request', "'to' is required", 400)
  }

  const { data: connection } = await db
    .from('meta_page_connections')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!connection) {
    throw new SendMessageError(
      'meta_not_configured',
      'Instagram and Messenger are not connected. Connect a Facebook Page in Settings first.',
      400,
    )
  }

  let ownerUserId: string
  try {
    ownerUserId = await resolveAuditUserId(db, accountId)
  } catch (err) {
    if (err instanceof ContactError) {
      throw new SendMessageError('db_error', err.message, err.status)
    }
    throw err
  }

  const { data: existing } = await db
    .from('contacts')
    .select('id, name, avatar_url')
    .eq('account_id', accountId)
    .eq('channel', channel)
    .eq('channel_user_id', scopedId)
    .maybeSingle()

  let contactId: string
  let contactCreated = false

  if (existing) {
    contactId = existing.id
    const patch: Record<string, unknown> = {}
    if (args.name && args.name !== existing.name) patch.name = args.name
    if (args.avatarUrl && args.avatarUrl !== existing.avatar_url) {
      patch.avatar_url = args.avatarUrl
    }
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString()
      await db.from('contacts').update(patch).eq('id', existing.id)
    }
  } else {
    const { data: created, error: createErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: ownerUserId,
        phone: null,
        name: args.name || scopedId,
        avatar_url: args.avatarUrl ?? null,
        channel,
        channel_user_id: scopedId,
      })
      .select('id')
      .single()

    if (createErr || !created) {
      if (isUniqueViolation(createErr)) {
        const { data: raced } = await db
          .from('contacts')
          .select('id')
          .eq('account_id', accountId)
          .eq('channel', channel)
          .eq('channel_user_id', scopedId)
          .maybeSingle()
        if (raced) {
          contactId = raced.id
        } else {
          throw new SendMessageError('db_error', 'Failed to create contact', 500)
        }
      } else {
        console.error('[meta/resolve] contact create error:', createErr)
        throw new SendMessageError('db_error', 'Failed to create contact', 500)
      }
    } else {
      contactId = created.id
      contactCreated = true
    }
  }

  const conversationId = await findOrCreateChannelConversation(
    db,
    accountId,
    contactId,
    ownerUserId,
    channel,
  )

  return { conversationId, contactId, contactCreated }
}

async function findOrCreateChannelConversation(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  ownerUserId: string,
  channel: ChannelType,
): Promise<string> {
  const { data: existing, error: findErr } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findErr) {
    console.error('[meta/resolve] conversation lookup error:', findErr)
    throw new SendMessageError('db_error', 'Failed to resolve conversation', 500)
  }
  if (existing && existing.length > 0) return existing[0].id

  const { data: newConv, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
      channel,
    })
    .select('id')
    .single()

  if (convErr || !newConv) {
    if (isUniqueViolation(convErr)) {
      const { data: raced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return raced[0].id
    }
    console.error('[meta/resolve] conversation create error:', convErr)
    throw new SendMessageError('db_error', 'Failed to create conversation', 500)
  }

  return newConv.id
}
