/**
 * WhatsApp Cloud API `calls` webhook field.
 *
 * Connect: persist SDP + ringing row + thread bubble, bump the
 * conversation. Terminate: finalize status/duration. Recording:
 * download Meta's mixed audio after hang-up and attach it to the thread.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallStatus } from '@/types'

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { encodeCallPreview } from '@/lib/calls/preview'
import { persistMetaCallRecording } from '@/lib/calling/persist-meta-recording'
import { processCallRecording } from '@/lib/calling/process-recording'
import { normalizeOfferSdp } from '@/lib/calls/sdp'
import { decrypt } from '@/lib/whatsapp/encryption'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

export interface CallsWebhookCall {
  id: string
  to?: string
  from?: string
  event?: string
  timestamp?: string
  direction?: string
  status?: string | string[]
  start_time?: string | number
  end_time?: string | number
  duration?: number
  session?: { sdp_type?: string; sdp?: string }
  connection?: { webrtc?: { sdp?: string } }
  errors?: Array<{ code?: number; message?: string }>
  call_recording?: {
    type?: string
    audio?: {
      id?: string
      sha256?: string
      mime_type?: string
      url?: string
    }
  }
}

export interface CallsWebhookValue {
  messaging_product?: string
  metadata: {
    display_phone_number?: string
    phone_number_id: string
  }
  contacts?: Array<{
    profile?: { name?: string }
    wa_id?: string
  }>
  calls?: CallsWebhookCall[]
}

export async function handleCallsWebhook(
  value: CallsWebhookValue,
  db: SupabaseClient,
): Promise<void> {
  const calls = value.calls
  if (!calls || calls.length === 0) return

  const phoneNumberId = value.metadata.phone_number_id
  const { data: configRows, error: configError } = await db
    .from('whatsapp_config')
    .select('account_id, user_id, access_token')
    .eq('phone_number_id', phoneNumberId)

  if (configError) {
    console.error(
      '[calls webhook] config lookup failed for phone_number_id:',
      phoneNumberId,
      configError,
    )
    return
  }
  if (!configRows || configRows.length === 0) {
    console.error(
      '[calls webhook] no config for phone_number_id:',
      phoneNumberId,
    )
    return
  }
  if (configRows.length > 1) {
    console.error(
      `[calls webhook] multiple configs (${configRows.length}) for phone_number_id:`,
      phoneNumberId,
    )
    return
  }

  const config = configRows[0] as {
    account_id: string
    user_id: string
    access_token?: string
  }

  for (const call of calls) {
    if (!call?.id || !call.event) continue
    try {
      if (call.event === 'connect') {
        await handleConnect(db, value, call, config)
      } else if (call.event === 'terminate') {
        await handleTerminate(db, call)
      } else if (call.event === 'call_recording_available') {
        await handleRecordingAvailable(db, call, config)
      } else {
        console.info('[calls webhook] ignoring event:', call.event, call.id)
      }
    } catch (err) {
      console.error(
        '[calls webhook] handler failed:',
        call.event,
        call.id,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

function resolveUserPhone(
  value: CallsWebhookValue,
  call: CallsWebhookCall,
): string | null {
  const waId = value.contacts?.[0]?.wa_id
  if (waId) return normalizePhone(waId)

  const business = normalizePhone(value.metadata.display_phone_number ?? '')
  const from = normalizePhone(call.from ?? '')
  const to = normalizePhone(call.to ?? '')
  if (from && from !== business) return from
  if (to && to !== business) return to
  return from || to || null
}

async function handleConnect(
  db: SupabaseClient,
  value: CallsWebhookValue,
  call: CallsWebhookCall,
  config: { account_id: string; user_id: string },
): Promise<void> {
  const { data: existing } = await db
    .from('calls')
    .select('id, status')
    .eq('meta_call_id', call.id)
    .maybeSingle()

  if (existing) {
    // Replay of the connect webhook — do not reset an in-flight call.
    return
  }

  const userPhone = resolveUserPhone(value, call)
  if (!userPhone) {
    console.error('[calls webhook] connect missing user phone:', call.id)
    return
  }

  const contactName = value.contacts?.[0]?.profile?.name ?? userPhone
  const contactOutcome = await findOrCreateContact(
    db,
    config.account_id,
    config.user_id,
    userPhone,
    contactName,
  )
  if (!contactOutcome) return

  const convResult = await findOrCreateConversation(
    db,
    config.account_id,
    config.user_id,
    contactOutcome.id,
  )
  if (!convResult) return

  const createdAt = unixToIso(call.timestamp)
  const rawSdp = call.session?.sdp ?? call.connection?.webrtc?.sdp ?? null
  const sdpOffer = rawSdp ? normalizeOfferSdp(rawSdp) : null

  const { data: inserted, error: insertErr } = await db
    .from('calls')
    .insert({
      account_id: config.account_id,
      conversation_id: convResult.id,
      contact_id: contactOutcome.id,
      meta_call_id: call.id,
      direction: 'user_initiated',
      status: 'ringing',
      from_phone: userPhone,
      to_phone: normalizePhone(value.metadata.display_phone_number ?? ''),
      sdp_offer: sdpOffer,
      created_at: createdAt,
    })
    .select('id')
    .maybeSingle()

  if (insertErr) {
    if (isUniqueViolation(insertErr)) return
    console.error('[calls webhook] insert failed:', insertErr)
    return
  }
  if (!inserted) return

  const preview = encodeCallPreview('ringing')
  const { error: msgErr } = await db.from('messages').upsert(
    {
      conversation_id: convResult.id,
      sender_type: 'customer',
      content_type: 'call',
      content_text: preview,
      message_id: call.id,
      status: 'delivered',
      created_at: createdAt,
    },
    { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
  )
  if (msgErr) {
    console.error('[calls webhook] message upsert failed:', msgErr)
  }

  const { error: bumpErr } = await db.rpc('bump_conversation_on_inbound', {
    p_conversation_id: convResult.id,
    p_last_message_text: preview,
  })
  if (bumpErr) {
    console.error('[calls webhook] conversation bump failed:', bumpErr)
  }
}

async function handleTerminate(
  db: SupabaseClient,
  call: CallsWebhookCall,
): Promise<void> {
  const { data: row, error: fetchErr } = await db
    .from('calls')
    .select('id, status, conversation_id, duration_seconds')
    .eq('meta_call_id', call.id)
    .maybeSingle()

  if (fetchErr) {
    console.error('[calls webhook] terminate lookup failed:', fetchErr)
    return
  }
  if (!row) {
    console.warn('[calls webhook] terminate for unknown call:', call.id)
    return
  }

  const current = row.status as CallStatus
  let next: CallStatus
  if (current === 'rejected') {
    next = 'rejected'
  } else if (current === 'ringing' || current === 'connecting') {
    next = 'missed'
  } else {
    next = parseTerminateOutcome(call.status)
  }

  const duration =
    typeof call.duration === 'number'
      ? call.duration
      : (row.duration_seconds as number | null)
  const endedAt = unixToIso(call.end_time) ?? unixToIso(call.timestamp)
  const startedAt = unixToIso(call.start_time)
  const err = firstCallError(call)

  const update: Record<string, unknown> = {
    status: next,
    ended_at: endedAt,
    duration_seconds: duration ?? null,
  }
  if (startedAt) update.started_at = startedAt
  if (err) {
    update.error_code = err.code ?? null
    update.error_message = err.message ?? null
  }

  const { error: updErr } = await db.from('calls').update(update).eq('id', row.id)
  if (updErr) {
    console.error('[calls webhook] terminate update failed:', updErr)
    return
  }

  const preview = encodeCallPreview(next, duration)
  if (row.conversation_id) {
    await db
      .from('messages')
      .update({ content_text: preview })
      .eq('conversation_id', row.conversation_id)
      .eq('message_id', call.id)

    await db
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: endedAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.conversation_id)
  }
}

async function handleRecordingAvailable(
  db: SupabaseClient,
  call: CallsWebhookCall,
  config: { account_id: string; access_token?: string },
): Promise<void> {
  const audio = call.call_recording?.audio
  if (!audio?.id) {
    console.warn('[calls webhook] recording event missing audio id:', call.id)
    return
  }
  if (!config.access_token) {
    console.error('[calls webhook] recording missing access token')
    return
  }
  let accessToken: string
  try {
    accessToken = decrypt(config.access_token)
  } catch {
    console.error('[calls webhook] recording token decrypt failed')
    return
  }

  const persisted = await persistMetaCallRecording({
    db,
    accountId: config.account_id,
    metaCallId: call.id,
    accessToken,
    audio: {
      id: audio.id,
      sha256: audio.sha256,
      mime_type: audio.mime_type,
    },
  })
  if (!persisted) return

  void processCallRecording({
    accountId: config.account_id,
    callId: persisted.callId,
    settings: persisted.settings,
  }).catch((err) => {
    console.error('[calls webhook] post-recording pipeline', err)
  })
}

function parseTerminateOutcome(raw: unknown): CallStatus {
  const values = Array.isArray(raw) ? raw : [raw]
  const joined = values.map(String).join(' ').toLowerCase()
  if (joined.includes('fail')) return 'failed'
  return 'completed'
}

function firstCallError(
  call: CallsWebhookCall,
): { code?: number; message?: string } | null {
  const err = call.errors?.[0]
  if (!err) return null
  return { code: err.code, message: err.message }
}

function unixToIso(value: string | number | undefined): string | undefined {
  if (value == null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return undefined
  const ms = n > 1e12 ? n : n * 1000
  return new Date(ms).toISOString()
}

async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string,
): Promise<{ id: string } | null> {
  const existing = await findExistingContact(db, accountId, phone)
  if (existing) {
    if (name && name !== existing.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return { id: existing.id }
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      phone,
      name: name || phone,
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, phone)
      if (raced) return { id: raced.id }
    }
    console.error('[calls webhook] contact create failed:', error)
    return null
  }
  return created
}

async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string,
): Promise<{ id: string } | null> {
  const { data: existing, error: findErr } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)

  if (findErr) {
    console.error('[calls webhook] conversation lookup failed:', findErr)
    return null
  }
  if (existing && existing.length > 0) return existing[0]

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: ownerUserId,
      contact_id: contactId,
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const { data: raced } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return raced[0]
    }
    console.error('[calls webhook] conversation create failed:', error)
    return null
  }
  return created
}
