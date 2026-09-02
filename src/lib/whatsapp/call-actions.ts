/**
 * Server-side WhatsApp calling actions.
 *
 * Graph calls use the decrypted account token. Row writes use the
 * service role because `calls` is SELECT-only under RLS. First agent
 * to pre-accept claims a ringing row (`status = ringing`).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Call, CallStatus } from '@/types'

import { decrypt } from '@/lib/whatsapp/encryption'
import {
  callAction,
  MetaApiError,
  updateCallSettings,
  type CallGraphAction,
  type CallRecordingPayload,
  type CallSettingsCalling,
} from '@/lib/whatsapp/meta-api'
import { encodeCallPreview } from '@/lib/calls/preview'
import { ensureCallingSettings, metaRecordingPayload } from '@/lib/calling/settings'

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export class CallActionError extends Error {
  readonly status: number
  readonly code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'CallActionError'
    this.status = status
    this.code = code
  }
}

interface WhatsAppCreds {
  phoneNumberId: string
  accessToken: string
}

async function loadCreds(accountId: string): Promise<WhatsAppCreds> {
  const { data, error } = await admin()
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    throw new CallActionError(500, 'Failed to load WhatsApp configuration')
  }
  if (!data) {
    throw new CallActionError(400, 'WhatsApp is not configured', 'not_configured')
  }

  let accessToken: string
  try {
    accessToken = decrypt(data.access_token)
  } catch {
    throw new CallActionError(500, 'Could not decrypt the WhatsApp access token')
  }

  return { phoneNumberId: data.phone_number_id, accessToken }
}

async function loadCall(
  accountId: string,
  callId: string,
): Promise<Call> {
  const { data, error } = await admin()
    .from('calls')
    .select('*')
    .eq('id', callId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    throw new CallActionError(500, 'Failed to load call')
  }
  if (!data) {
    throw new CallActionError(404, 'Call not found')
  }
  return data as Call
}

async function graphCall(
  creds: WhatsAppCreds,
  metaCallId: string,
  action: CallGraphAction,
  sdp?: string,
  recording?: CallRecordingPayload,
): Promise<void> {
  try {
    await callAction({
      phoneNumberId: creds.phoneNumberId,
      accessToken: creds.accessToken,
      callId: metaCallId,
      action,
      session: sdp
        ? { sdpType: 'answer', sdp }
        : undefined,
      recording,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Calling API failed'
    throw new CallActionError(502, message)
  }
}

async function syncThreadPreview(
  call: Call,
  status: CallStatus,
  durationSeconds?: number | null,
): Promise<void> {
  if (!call.conversation_id || !call.meta_call_id) return
  const preview = encodeCallPreview(status, durationSeconds)
  await admin()
    .from('messages')
    .update({ content_text: preview })
    .eq('conversation_id', call.conversation_id)
    .eq('message_id', call.meta_call_id)
  await admin()
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', call.conversation_id)
}

/**
 * Atomically claim a ringing call for `userId`. Returns the claimed
 * row, or null if another agent already took it.
 */
export async function claimRingingCall(
  accountId: string,
  callId: string,
  userId: string,
  opts?: { aiAnswered?: boolean },
): Promise<Call | null> {
  const { data, error } = await admin()
    .from('calls')
    .update({
      status: 'connecting',
      answered_by: userId,
      ai_answered: Boolean(opts?.aiAnswered),
    })
    .eq('id', callId)
    .eq('account_id', accountId)
    .eq('status', 'ringing')
    .select('*')
    .maybeSingle()

  if (error) {
    throw new CallActionError(500, 'Failed to claim call')
  }
  return (data as Call | null) ?? null
}

export async function preAcceptCall(args: {
  accountId: string
  userId: string
  callId: string
  sdp: string
  aiAnswered?: boolean
}): Promise<Call> {
  const { accountId, userId, callId, sdp } = args
  if (!sdp.trim()) {
    throw new CallActionError(400, 'sdp is required')
  }

  const claimed = await claimRingingCall(accountId, callId, userId, {
    aiAnswered: args.aiAnswered,
  })
  if (!claimed) {
    throw new CallActionError(409, 'Call already claimed', 'already_claimed')
  }

  const creds = await loadCreds(accountId)
  try {
    await graphCall(creds, claimed.meta_call_id, 'pre_accept', sdp)
  } catch (err) {
    await admin()
      .from('calls')
      .update({ status: 'ringing', answered_by: null, ai_answered: false })
      .eq('id', claimed.id)
      .eq('status', 'connecting')
    throw err
  }

  await syncThreadPreview(claimed, 'connecting')
  return { ...claimed, status: 'connecting', answered_by: userId }
}

export async function acceptCall(args: {
  accountId: string
  userId: string
  callId: string
  sdp: string
}): Promise<Call> {
  const { accountId, userId, callId, sdp } = args
  if (!sdp.trim()) {
    throw new CallActionError(400, 'sdp is required')
  }

  const call = await loadCall(accountId, callId)
  if (call.status !== 'connecting') {
    throw new CallActionError(409, 'Call is not waiting to be accepted', 'bad_state')
  }
  if (call.answered_by && call.answered_by !== userId) {
    throw new CallActionError(409, 'Call already claimed', 'already_claimed')
  }

  const creds = await loadCreds(accountId)
  const settings = await ensureCallingSettings(admin(), accountId)
  const recording = metaRecordingPayload(settings)
  if (settings.recording_enabled && !recording) {
    throw new CallActionError(400, 'Recording purpose is required', 'recording_purpose')
  }
  await graphCall(creds, call.meta_call_id, 'accept', sdp, recording ?? undefined)

  const startedAt = new Date().toISOString()
  const { data, error } = await admin()
    .from('calls')
    .update({
      status: 'in_progress',
      started_at: startedAt,
      answered_by: userId,
    })
    .eq('id', call.id)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    throw new CallActionError(500, 'Failed to update call')
  }

  await syncThreadPreview(call, 'in_progress')
  return data as Call
}

export async function rejectCall(args: {
  accountId: string
  userId: string
  callId: string
}): Promise<Call> {
  const { accountId, userId, callId } = args

  const { data: claimed, error } = await admin()
    .from('calls')
    .update({
      status: 'rejected',
      answered_by: userId,
      ended_at: new Date().toISOString(),
    })
    .eq('id', callId)
    .eq('account_id', accountId)
    .eq('status', 'ringing')
    .select('*')
    .maybeSingle()

  if (error) {
    throw new CallActionError(500, 'Failed to reject call')
  }
  if (!claimed) {
    throw new CallActionError(409, 'Call is no longer ringing', 'already_claimed')
  }

  const creds = await loadCreds(accountId)
  try {
    await graphCall(creds, (claimed as Call).meta_call_id, 'reject')
  } catch (err) {
    // Local reject still stands — Meta may already have hung up.
    console.error('[calls] reject Graph call failed:', err instanceof Error ? err.message : err)
  }

  await syncThreadPreview(claimed as Call, 'rejected')
  return claimed as Call
}

export async function terminateCall(args: {
  accountId: string
  userId: string
  callId: string
}): Promise<Call> {
  const { accountId, callId } = args
  const call = await loadCall(accountId, callId)
  if (call.status !== 'connecting' && call.status !== 'in_progress') {
    throw new CallActionError(409, 'Call is not active', 'bad_state')
  }

  const creds = await loadCreds(accountId)
  try {
    await graphCall(creds, call.meta_call_id, 'terminate')
  } catch (err) {
    console.error(
      '[calls] terminate Graph call failed:',
      err instanceof Error ? err.message : err,
    )
  }

  const endedAt = new Date().toISOString()
  let duration: number | null = call.duration_seconds ?? null
  if (call.started_at) {
    duration = Math.max(
      0,
      Math.round((Date.parse(endedAt) - Date.parse(call.started_at)) / 1000),
    )
  }

  const { data, error } = await admin()
    .from('calls')
    .update({
      status: 'completed',
      ended_at: endedAt,
      duration_seconds: duration,
    })
    .eq('id', call.id)
    .select('*')
    .maybeSingle()

  if (error || !data) {
    throw new CallActionError(500, 'Failed to update call')
  }

  await syncThreadPreview(call, 'completed', duration)
  return data as Call
}

export function callingErrorMessage(err: unknown): {
  message: string
  code?: number
} {
  if (err instanceof MetaApiError) {
    return { message: err.message, code: err.code }
  }
  if (err instanceof Error) return { message: err.message }
  return { message: 'Unknown error' }
}

export async function setCallingEnabled(args: {
  accountId: string
  enabled: boolean
  call_icon_visibility?: 'DEFAULT' | 'DISABLE_ALL'
}): Promise<{ calling_status: 'enabled' | 'disabled' }> {
  const { accountId, enabled } = args
  const creds = await loadCreds(accountId)
  const status = enabled ? 'ENABLED' : 'DISABLED'
  const icon = args.call_icon_visibility ?? 'DEFAULT'

  try {
    await updateCallSettings({
      phoneNumberId: creds.phoneNumberId,
      accessToken: creds.accessToken,
      calling: enabled
        ? { status, call_icon_visibility: icon }
        : { status },
    })
  } catch (err) {
    const { message, code } = callingErrorMessage(err)
    await admin()
      .from('whatsapp_config')
      .update({ last_calling_error: message })
      .eq('account_id', accountId)
    const mapped = mapCallingEnableError(code, message)
    throw new CallActionError(400, mapped, code != null ? String(code) : undefined)
  }

  const calling_status = enabled ? 'enabled' : 'disabled'
  const { error } = await admin()
    .from('whatsapp_config')
    .update({
      calling_status,
      last_calling_error: null,
    })
    .eq('account_id', accountId)

  if (error) {
    throw new CallActionError(500, 'Failed to save calling status')
  }

  return { calling_status }
}

export async function syncMetaCallAppearance(args: {
  accountId: string
  enabled: boolean
  call_icon_visibility: 'DEFAULT' | 'DISABLE_ALL'
  call_hours?: CallSettingsCalling['call_hours'] | null
}): Promise<void> {
  const creds = await loadCreds(args.accountId)
  const calling: CallSettingsCalling = {
    status: args.enabled ? 'ENABLED' : 'DISABLED',
    call_icon_visibility: args.call_icon_visibility,
  }
  if (args.call_hours) calling.call_hours = args.call_hours
  try {
    await updateCallSettings({
      phoneNumberId: creds.phoneNumberId,
      accessToken: creds.accessToken,
      calling,
    })
  } catch (err) {
    const { message, code } = callingErrorMessage(err)
    await admin()
      .from('whatsapp_config')
      .update({ last_calling_error: message })
      .eq('account_id', args.accountId)
    throw new CallActionError(
      400,
      mapCallingEnableError(code, message),
      code != null ? String(code) : undefined,
    )
  }
}

export function mapCallingEnableError(code: number | undefined, fallback: string): string {
  if (code === 138015) {
    return 'Calling cannot be enabled until this number has a daily messaging limit of at least 2,000 unique recipients (or use a Meta public test number).'
  }
  if (code === 138018) {
    return 'Subscribe this app to the "calls" webhook field in the Meta App Dashboard (WhatsApp → Configuration), then try again.'
  }
  return fallback
}

/** Exposed for tests that swap the admin client. */
export function __setCallActionsAdminForTests(client: SupabaseClient | null) {
  _admin = client
}
