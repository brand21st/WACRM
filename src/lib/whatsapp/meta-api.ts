/**
 * Meta WhatsApp Cloud API helpers.
 *
 * Every function takes a single options object (named parameters) instead
 * of positional arguments. This was a deliberate choice after the same
 * swapped-args bug was found four times in a row with the positional form
 * (e.g. `(accessToken, phoneNumberId)` vs `(phoneNumberId, accessToken)`).
 * With named params, a typo surfaces immediately as a TypeScript error
 * instead of a runtime rejection from Meta.
 */

import { createSemaphore } from '@/lib/concurrency'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaSendResult {
  messageId: string
}

export interface MetaPhoneInfo {
  id: string
  display_phone_number: string
  verified_name?: string
  quality_rating?: string
}

interface MetaErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

/** Graph API error with Meta's numeric `error.code` when present. */
export class MetaApiError extends Error {
  readonly code?: number
  readonly httpStatus: number
  constructor(
    message: string,
    opts?: { code?: number; httpStatus?: number },
  ) {
    super(message)
    this.name = 'MetaApiError'
    this.code = opts?.code
    this.httpStatus = opts?.httpStatus ?? 0
  }
}

async function throwMetaError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  let code: number | undefined
  try {
    const data = (await response.json()) as MetaErrorResponse
    if (data.error?.message) message = data.error.message
    if (typeof data.error?.code === 'number') code = data.error.code
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new MetaApiError(message, { code, httpStatus: response.status })
}

// ============================================================
// Phone number / account
// ============================================================

export interface VerifyPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
}

/**
 * Verify a Meta phone number ID by fetching its public metadata
 * (display_phone_number, verified_name, quality_rating).
 */
export async function verifyPhoneNumber(
  args: VerifyPhoneNumberArgs
): Promise<MetaPhoneInfo> {
  const { phoneNumberId, accessToken } = args
  const url = `${META_API_BASE}/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// Cloud API registration (subscription for inbound webhooks)
// ============================================================
//
// Saving a phone_number_id + access_token to whatsapp_config is NOT
// enough to receive inbound events from Meta. Two extra calls are
// required:
//
//   POST /{phone_number_id}/register
//     Subscribes the number for THIS app's webhook. Requires a
//     6-digit 2FA PIN the user previously set in Meta WhatsApp
//     Manager → Two-step verification. Without /register, inbound
//     events are routed to whichever app last claimed the number
//     (often the one that did Embedded Signup) — so a second user
//     adding a second number under the same WABA silently loses
//     every inbound message.
//
//   POST /{waba_id}/subscribed_apps
//     Subscribes the WABA itself to this app. Required exactly
//     once per WABA, but idempotent so calling on every save is
//     safe and cheap.
//
// Both calls are no-ops when already done — Meta returns success +
// the helpers below treat that as success.

export interface RegisterPhoneNumberArgs {
  phoneNumberId: string
  accessToken: string
  /**
   * 6-digit PIN the user set in Meta WhatsApp Manager →
   * Two-step verification. If 2FA is not enabled on the number,
   * Meta rejects /register with a clear error and the user is
   * pointed at the right setting in the UI.
   */
  pin: string
}

export interface RegisterPhoneNumberResult {
  success: boolean
  /**
   * True when Meta indicated the number was already registered to
   * THIS app — same outcome as a fresh registration from the
   * caller's POV, surfaced separately for logging clarity.
   */
  alreadyRegistered: boolean
}

/**
 * Register a phone number for inbound webhook events.
 *
 * Errors that should be surfaced verbatim to the user:
 *   * Missing / wrong PIN  → "Two-step verification PIN required..."
 *   * No 2FA enabled       → "Two-factor authentication is not on..."
 *   * Number on other app  → "Number is registered to another app..."
 */
export async function registerPhoneNumber(
  args: RegisterPhoneNumberArgs
): Promise<RegisterPhoneNumberResult> {
  const { phoneNumberId, accessToken, pin } = args
  const url = `${META_API_BASE}/${phoneNumberId}/register`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })

  if (response.ok) {
    return { success: true, alreadyRegistered: false }
  }

  // Meta returns an error envelope with a code. Code 133005 + the
  // text "already registered" appears when the number is already
  // subscribed to this app — that's success from the caller's
  // perspective, surface it as such.
  let data: { error?: { message?: string; code?: number; error_subcode?: number } } = {}
  try {
    data = await response.json()
  } catch {
    /* keep empty */
  }
  const message = data.error?.message ?? `Meta API error: ${response.status}`
  if (/already.*registered/i.test(message)) {
    return { success: true, alreadyRegistered: true }
  }
  throw new Error(message)
}

export interface SubscribeWabaToAppArgs {
  wabaId: string
  accessToken: string
}

/**
 * Subscribe the WABA to this Meta app's webhook. Idempotent — Meta
 * returns success even when the subscription already exists.
 */
export async function subscribeWabaToApp(
  args: SubscribeWabaToAppArgs
): Promise<void> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

export interface GetSubscribedAppsArgs {
  wabaId: string
  accessToken: string
}

export interface SubscribedApp {
  whatsapp_business_api_data?: {
    id?: string
    name?: string
    link?: string
  }
}

/**
 * Diagnostic — fetch the list of apps currently subscribed to this
 * WABA. The UI uses this to confirm OUR app is in the list when
 * the user clicks Verify Registration.
 */
export async function getSubscribedApps(
  args: GetSubscribedAppsArgs
): Promise<SubscribedApp[]> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/subscribed_apps`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: SubscribedApp[] }
  return data.data ?? []
}

// ============================================================
// Sending
// ============================================================

export interface SendTextMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  text: string
  /** Meta's message_id of the message being replied to. Adds a `context` field
   *  so WhatsApp renders the new message as a reply with a quote preview. */
  contextMessageId?: string
}

/**
 * Send a free-form WhatsApp text message.
 * Only works inside the 24-hour customer service window.
 */
export async function sendTextMessage(
  args: SendTextMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, text, contextMessageId } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface SendTypingIndicatorArgs {
  phoneNumberId: string
  accessToken: string
  /** Meta `messages.id` from the inbound webhook. */
  messageId: string
}

/**
 * Mark an inbound message as read and show the WhatsApp typing
 * animation. Dismisses when we send a reply, or after 25 seconds.
 * `typing_indicator.type` is always `"text"` — Meta has no audio-typing
 * variant; the same animation covers a forthcoming voice reply.
 *
 * https://developers.facebook.com/docs/whatsapp/cloud-api/typing-indicators
 */
export async function sendTypingIndicator(
  args: SendTypingIndicatorArgs,
): Promise<void> {
  const { phoneNumberId, accessToken, messageId } = args
  if (!messageId.trim()) {
    throw new Error('sendTypingIndicator requires a messageId.')
  }
  // Typing indicators landed after Graph v21. Pin a version Meta documents
  // for this payload so a v21 reject can't silently skip the animation.
  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      typing_indicator: { type: 'text' },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

export type MediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendMediaMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  kind: MediaKind
  /** Public URL Meta fetches at send time. */
  link: string
  /** Optional caption — Meta caps at 1024 chars. Documents + images + videos accept it; audio does NOT. */
  caption?: string
  /** Document-only. Shown in the recipient's chat as the file name. Ignored for image/video/audio. */
  filename?: string
  /**
   * Audio-only. When true, Meta renders the OGG/Opus file as a native
   * WhatsApp voice note (waveform + mic icon) instead of a file attachment.
   */
  voice?: boolean
  contextMessageId?: string
}

/**
 * Send an image, video, document, or audio (voice note) via a public URL.
 *
 * Used by the Flows engine's `send_media` node and the inbox composer's
 * agent-initiated media sends. Mirrors `sendTextMessage` — single fetch,
 * throws on non-2xx, returns Meta's message id.
 *
 * Audio is special-cased: Meta rejects `caption` and `filename` on audio
 * messages. Pass `voice: true` with an OGG/Opus link so WhatsApp renders
 * a native voice note (waveform) rather than a downloadable audio file.
 */
export async function sendMediaMessage(
  args: SendMediaMessageArgs,
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    kind,
    link,
    caption,
    filename,
    voice,
    contextMessageId,
  } = args
  if (!link) throw new Error('sendMediaMessage requires a link.')
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  // Audio accepts neither caption nor filename per Meta's spec — adding
  // either yields a 400. image/video/document accept a caption; only
  // document accepts a filename.
  const media: Record<string, unknown> = { link }
  if (caption && kind !== 'audio') media.caption = caption
  if (kind === 'document' && filename) media.filename = filename
  if (kind === 'audio' && voice) media.voice = true

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: kind,
    [kind]: media,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

import type { MessageTemplate } from '@/types'
import {
  buildSendComponents,
  type SendTimeParams,
} from './template-send-builder'

export interface SendTemplateMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  templateName: string
  language?: string
  /**
   * Legacy body-only params. Kept for backward compat with callers
   * that haven't migrated to the structured `template` + `messageParams`
   * pair below. New callers should pass `template` so media headers
   * and URL buttons land on the send.
   */
  params?: string[]
  /**
   * The template row from message_templates. When provided, the helper
   * builds the full components array (header + body + buttons) via
   * buildSendComponents — that's the only way image/video/document
   * headers and URL-with-variable buttons actually reach the recipient.
   */
  template?: MessageTemplate
  /**
   * Structured per-send values. Body variables go in `body`; header
   * text variables in `headerText`; media overrides in
   * `headerMediaUrl` / `headerMediaId`; URL/COPY_CODE button values
   * in `buttonParams` keyed by index.
   */
  messageParams?: SendTimeParams
  /** Meta's message_id of the message being replied to. */
  contextMessageId?: string
}

/**
 * Send a pre-approved WhatsApp message template. Required outside
 * the 24-hour window and for any first-touch messaging.
 *
 * Caller paths:
 *   - Legacy: pass `params: string[]` (body only). Same behaviour as
 *     before this helper learned about media + buttons.
 *   - Structured: pass `template` (and optionally `messageParams`).
 *     The full components array is built from the row so media
 *     headers + URL buttons land correctly.
 */
export async function sendTemplateMessage(
  args: SendTemplateMessageArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    templateName,
    language = 'en_US',
    params,
    template,
    messageParams,
    contextMessageId,
  } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`

  const templatePayload: Record<string, unknown> = {
    name: templateName,
    language: { code: language },
  }

  if (template) {
    const components = buildSendComponents(template, {
      // Legacy callers pass body values in `params`; fold them into
      // `messageParams.body` so the new path covers them too.
      body: messageParams?.body ?? params,
      headerText: messageParams?.headerText,
      headerMediaUrl: messageParams?.headerMediaUrl,
      headerMediaId: messageParams?.headerMediaId,
      buttonParams: messageParams?.buttonParams,
    })
    if (components.length > 0) {
      templatePayload.components = components
    }
  } else if (params && params.length > 0) {
    // Legacy body-only path — no template row available.
    templatePayload.components = [
      {
        type: 'body',
        parameters: params.map((p) => ({ type: 'text', text: String(p) })),
      },
    ]
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: templatePayload,
  }
  if (contextMessageId) {
    body.context = { message_id: contextMessageId }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Resumable Upload (media handles for template headers)
// ============================================================
//
// Creating a message template with a media HEADER (image/video/
// document) requires an `example.header_handle` — Meta does NOT accept
// a plain public URL at creation time. The handle comes from the
// two-step Resumable Upload API, which is keyed on the Meta APP id (not
// the phone number / WABA):
//
//   1. POST /{app_id}/uploads?file_name&file_length&file_type&access_token
//        → { id: "upload:<session>" }
//   2. POST /{id}  (Authorization: OAuth <token>, file_offset: 0, raw bytes)
//        → { h: "<handle>" }
//
// See https://developers.facebook.com/docs/graph-api/guides/upload

export interface UploadResumableMediaArgs {
  /** Meta App id (env META_APP_ID) — resumable upload is app-scoped. */
  appId: string
  accessToken: string
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

/**
 * Upload a file via the Resumable Upload API and return the media
 * handle to use as `example.header_handle` when creating/editing a
 * template with a media header.
 */
export async function uploadResumableMedia(
  args: UploadResumableMediaArgs,
): Promise<{ handle: string }> {
  const { appId, accessToken, fileName, mimeType, bytes } = args

  // Step 1 — open an upload session.
  const startParams = new URLSearchParams({
    file_name: fileName,
    file_length: String(bytes.byteLength),
    file_type: mimeType,
    access_token: accessToken,
  })
  const startRes = await fetch(
    `${META_API_BASE}/${appId}/uploads?${startParams.toString()}`,
    { method: 'POST' },
  )
  if (!startRes.ok) {
    await throwMetaError(startRes, `Resumable upload start failed: ${startRes.status}`)
  }
  const startData = (await startRes.json()) as { id?: string }
  if (!startData.id) {
    throw new Error('Resumable upload did not return a session id.')
  }

  // Step 2 — upload the bytes. Note the `OAuth` auth scheme (not Bearer)
  // and the file_offset header, both required by this endpoint.
  const uploadRes = await fetch(`${META_API_BASE}/${startData.id}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: '0',
    },
    // Uint8Array is a valid BodyInit at runtime; cast around the
    // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
    body: bytes as unknown as BodyInit,
  })
  if (!uploadRes.ok) {
    await throwMetaError(uploadRes, `Resumable upload failed: ${uploadRes.status}`)
  }
  const uploadData = (await uploadRes.json()) as { h?: string }
  if (!uploadData.h) {
    throw new Error('Resumable upload did not return a file handle.')
  }
  return { handle: uploadData.h }
}

// ============================================================
// Template submission (Business Management API)
// ============================================================

import type { MetaTemplateSubmitPayload } from './template-components'

export interface SubmitMessageTemplateArgs {
  wabaId: string
  accessToken: string
  payload: MetaTemplateSubmitPayload
}

export interface SubmitMessageTemplateResult {
  id: string
  status: string
  category?: string
}

/**
 * Submit a message template to Meta for approval.
 *
 * Returns Meta's assigned template id + initial status (typically
 * PENDING). Caller persists `id` as `meta_template_id` so the
 * upcoming edit/delete flows can scope to this exact template (and
 * language variant) via `hsm_id`, rather than nuking every variant
 * with the same name.
 *
 * 429s from Meta (rate limit: 100 creates/hour/WABA) surface as a
 * regular `Error('Meta API error: 429')`. The route handler
 * distinguishes 429 and shows a more actionable toast.
 */
export async function submitMessageTemplate(
  args: SubmitMessageTemplateArgs
): Promise<SubmitMessageTemplateResult> {
  const { wabaId, accessToken, payload } = args
  const url = `${META_API_BASE}/${wabaId}/message_templates`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  if (!data?.id) {
    throw new Error('Meta accepted the template but returned no id.')
  }
  return {
    id: String(data.id),
    status: typeof data.status === 'string' ? data.status : 'PENDING',
    category: typeof data.category === 'string' ? data.category : undefined,
  }
}

export interface EditMessageTemplateArgs {
  /** Meta's template id (stored locally as `meta_template_id`). */
  metaTemplateId: string
  accessToken: string
  /** Send the full components array — Meta replaces, not patches. */
  components: MetaTemplateSubmitPayload['components']
  /** Optional — only certain category transitions are allowed by Meta. */
  category?: MetaTemplateSubmitPayload['category']
}

export interface EditMessageTemplateResult {
  success: boolean
}

/**
 * Edit an existing (APPROVED or REJECTED) message template.
 *
 * Meta caps edits at 10 per 30 days (and 1 per 24h for APPROVED
 * templates). Every edit re-triggers review, so the status flips
 * back to PENDING until Meta approves the new components.
 *
 * Note: PENDING / DISABLED / IN_APPEAL templates cannot be edited
 * — the route handler enforces that before calling here.
 */
export async function editMessageTemplate(
  args: EditMessageTemplateArgs
): Promise<EditMessageTemplateResult> {
  const { metaTemplateId, accessToken, components, category } = args
  const body: Record<string, unknown> = { components }
  if (category) body.category = category
  const response = await fetch(`${META_API_BASE}/${metaTemplateId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json().catch(() => ({}))
  return { success: data?.success !== false }
}

export interface DeleteMessageTemplateArgs {
  wabaId: string
  accessToken: string
  name: string
  /**
   * Without `hsm_id`, Meta deletes EVERY language variant of the
   * template with this `name`. Pass the row's `meta_template_id`
   * to scope to a single variant.
   */
  metaTemplateId?: string
}

/**
 * Delete a message template on Meta. Pass `metaTemplateId` to scope
 * to a single language variant — otherwise Meta nukes every variant
 * sharing the same `name`.
 */
export async function deleteMessageTemplate(
  args: DeleteMessageTemplateArgs
): Promise<void> {
  const { wabaId, accessToken, name, metaTemplateId } = args
  const params = new URLSearchParams({ name })
  if (metaTemplateId) params.set('hsm_id', metaTemplateId)
  const url = `${META_API_BASE}/${wabaId}/message_templates?${params.toString()}`
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // Treat a 404 as a no-op — the template is already gone on Meta's
  // side, and we still want the local row removed.
  if (response.status === 404) return
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** Meta's message_id of the message being reacted to. */
  targetMessageId: string
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string
}

/**
 * Send a reaction (or removal) to a previously-exchanged message.
 * Empty `emoji` removes the reaction per Meta's spec.
 */
export async function sendReactionMessage(
  args: SendReactionMessageArgs
): Promise<MetaSendResult> {
  const { phoneNumberId, accessToken, to, targetMessageId, emoji } = args
  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: targetMessageId, emoji },
    }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

// ============================================================
// Interactive (button replies + list messages)
// ============================================================
//
// Meta's two flavours of interactive message — used by the Flows
// engine to drive scripted chatbot menus. Caller passes plain
// JS values; helpers shape the Meta payload and enforce Meta's
// limits BEFORE the network call so the failure mode is a
// developer-facing error rather than a customer-facing one.

/**
 * Meta limits for interactive messages, hard-coded so violations
 * fail at build/save time rather than as a 400 from the Meta API
 * mid-conversation. See:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-list-messages
 */
export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const

export interface InteractiveButton {
  /** Stable id sent back in the webhook when tapped (≤ 256 chars). */
  id: string
  /** Visible label (≤ 20 chars per Meta). */
  title: string
}

export interface SendInteractiveButtonsArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  /** The body text — what the customer reads above the buttons. */
  bodyText: string
  /** Optional plain-text header (≤ 60 chars). */
  headerText?: string
  /** Optional grey footer line under the buttons (≤ 60 chars). */
  footerText?: string
  /** 1–3 buttons. Validated against Meta's limits before sending. */
  buttons: InteractiveButton[]
  /** Meta's message_id of the message being replied to (quote preview). */
  contextMessageId?: string
}

/**
 * Send an interactive message with up to 3 inline reply buttons. The
 * customer taps one and Meta delivers a webhook with
 * `messages[0].interactive.button_reply.id` set to the matching button.id.
 *
 * Validation throws BEFORE the network call so misconfigured flows
 * fail at save time, not during a live conversation.
 */
export async function sendInteractiveButtons(
  args: SendInteractiveButtonsArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, headerText, footerText, buttons, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (buttons.length < 1 || buttons.length > INTERACTIVE_LIMITS.maxButtons) {
    throw new Error(
      `Interactive button message requires 1-${INTERACTIVE_LIMITS.maxButtons} buttons (got ${buttons.length}).`
    )
  }
  const seenButtonIds = new Set<string>()
  for (const btn of buttons) {
    if (!btn.id) throw new Error('Interactive button missing id.')
    // Duplicate button ids make the tapped-button webhook ambiguous —
    // Meta rejects them, and the pre-flight validator (interactive.ts)
    // rejects them too, so guard here to keep the two paths in step.
    if (seenButtonIds.has(btn.id)) {
      throw new Error(`Interactive message has duplicate button id "${btn.id}".`)
    }
    seenButtonIds.add(btn.id)
    if (!btn.title) throw new Error(`Interactive button "${btn.id}" missing title.`)
    if (btn.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      throw new Error(
        `Interactive button title "${btn.title}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
      )
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: bodyText },
    action: {
      buttons: buttons.map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: b.title },
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface SendInteractiveCtaUrlArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  /** Visible button label (≤ 20 chars), e.g. Checkout. */
  displayText: string
  /** https URL opened on tap. */
  url: string
  headerText?: string
  footerText?: string
  /** Public product photo. Meta fetches it as the CTA card header. */
  headerImageUrl?: string
  contextMessageId?: string
}

/**
 * Send an interactive CTA URL message — one button that opens a link
 * (Shopify checkout). Unlike reply buttons, this does not echo a tap
 * id back to the webhook.
 */
export async function sendInteractiveCtaUrl(
  args: SendInteractiveCtaUrlArgs,
): Promise<MetaSendResult> {
  const {
    phoneNumberId,
    accessToken,
    to,
    bodyText,
    displayText,
    url,
    headerText,
    footerText,
    headerImageUrl,
    contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  if (!headerImageUrl) validateInteractiveHeaderFooter(headerText, footerText)
  const label = displayText.trim()
  if (!label) throw new Error('CTA URL button needs a label.')
  if (label.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `CTA URL label "${label}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`,
    )
  }
  const href = url.trim()
  if (!/^https?:\/\//i.test(href)) {
    throw new Error('CTA URL must be an http(s) link.')
  }

  const interactive: Record<string, unknown> = {
    type: 'cta_url',
    body: { text: bodyText },
    action: {
      name: 'cta_url',
      parameters: {
        display_text: label,
        url: href,
      },
    },
  }
  if (headerImageUrl?.trim()) {
    interactive.header = {
      type: 'image',
      image: { link: headerImageUrl.trim() },
    }
  } else if (headerText) {
    interactive.header = { type: 'text', text: headerText }
  }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

export interface InteractiveListRow {
  /** Stable id sent back in the webhook when tapped (≤ 200 chars). */
  id: string
  /** Visible row title (≤ 24 chars per Meta). */
  title: string
  /** Optional secondary line shown under the title (≤ 72 chars). */
  description?: string
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string
  rows: InteractiveListRow[]
}

export interface SendInteractiveListArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  /** Label of the tap-to-expand button on the message bubble. */
  buttonLabel: string
  headerText?: string
  footerText?: string
  /**
   * 1–10 rows TOTAL across all sections. Meta caps the *total*, not
   * per-section. Validation enforces this before send.
   */
  sections: InteractiveListSection[]
  contextMessageId?: string
}

/**
 * Send an interactive message with a tap-to-expand list of selectable
 * rows. Use when there are more options than the 3-button limit allows.
 * Webhook arrives with `messages[0].interactive.list_reply.id` set to
 * the matching row.id.
 */
export async function sendInteractiveList(
  args: SendInteractiveListArgs
): Promise<MetaSendResult> {
  const {
    phoneNumberId, accessToken, to,
    bodyText, buttonLabel, headerText, footerText, sections, contextMessageId,
  } = args
  validateInteractiveBody(bodyText)
  validateInteractiveHeaderFooter(headerText, footerText)
  if (!buttonLabel) throw new Error('Interactive list requires a buttonLabel.')
  if (buttonLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `Interactive list buttonLabel "${buttonLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`
    )
  }
  if (sections.length < 1 || sections.length > INTERACTIVE_LIMITS.maxListSections) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListSections} sections (got ${sections.length}).`
    )
  }
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0)
  if (totalRows < 1 || totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across all sections (got ${totalRows}).`
    )
  }
  const seenIds = new Set<string>()
  for (const section of sections) {
    for (const row of section.rows) {
      if (!row.id) throw new Error('Interactive list row missing id.')
      if (seenIds.has(row.id)) {
        throw new Error(`Interactive list has duplicate row id "${row.id}".`)
      }
      seenIds.add(row.id)
      if (!row.title) throw new Error(`Interactive list row "${row.id}" missing title.`)
      if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
        throw new Error(
          `Interactive list row title "${row.title}" exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`
        )
      }
      if (
        row.description &&
        row.description.length > INTERACTIVE_LIMITS.listRowDescriptionMaxLength
      ) {
        throw new Error(
          `Interactive list row description for "${row.id}" exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`
        )
      }
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'list',
    body: { text: bodyText },
    action: {
      button: buttonLabel,
      sections: sections.map((s) => ({
        ...(s.title ? { title: s.title } : {}),
        rows: s.rows.map((r) => ({
          id: r.id,
          title: r.title,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
    },
  }
  if (headerText) interactive.header = { type: 'text', text: headerText }
  if (footerText) interactive.footer = { text: footerText }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive,
  }
  if (contextMessageId) body.context = { message_id: contextMessageId }

  const url = `${META_API_BASE}/${phoneNumberId}/messages`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data.messages[0].id }
}

function validateInteractiveBody(bodyText: string): void {
  if (!bodyText) throw new Error('Interactive message requires bodyText.')
  if (bodyText.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Interactive bodyText exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars.`
    )
  }
}

function validateInteractiveHeaderFooter(
  headerText: string | undefined,
  footerText: string | undefined,
): void {
  if (headerText && headerText.length > INTERACTIVE_LIMITS.headerTextMaxLength) {
    throw new Error(
      `Interactive headerText exceeds ${INTERACTIVE_LIMITS.headerTextMaxLength} chars.`
    )
  }
  if (footerText && footerText.length > INTERACTIVE_LIMITS.footerMaxLength) {
    throw new Error(
      `Interactive footerText exceeds ${INTERACTIVE_LIMITS.footerMaxLength} chars.`
    )
  }
}

// ============================================================
// Media
// ============================================================

export interface GetMediaUrlArgs {
  mediaId: string
  accessToken: string
}

/**
 * Resolve a media ID to Meta's (short-lived, authenticated) CDN URL
 * plus the MIME type. Step one of the media-proxy flow.
 *
 * `fileSize` is Meta's `file_size` (bytes) and is what lets the
 * inbound mirror (issue #466) reject a file the `chat-media` bucket
 * would refuse WITHOUT downloading it first — a 90 MB document costs
 * nothing to skip here and a full transfer to skip after the fact.
 * Null when Meta omits the field or sends something non-numeric.
 */
export async function getMediaUrl(
  args: GetMediaUrlArgs
): Promise<{ url: string; mimeType: string; fileSize: number | null }> {
  const { mediaId, accessToken } = args
  const response = await fetch(`${META_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Media fetch failed: ${response.status}`)
  }
  const data = await response.json()
  if (!data.url) throw new Error('Media URL not found in Meta response')
  // Meta documents file_size as a number but has been observed sending
  // it as a numeric string; Number() handles both and NaN-guards junk.
  const size = Number(data.file_size)
  return {
    url: data.url,
    mimeType: data.mime_type || 'application/octet-stream',
    fileSize: Number.isFinite(size) && size >= 0 ? size : null,
  }
}

export interface DownloadMediaArgs {
  downloadUrl: string
  accessToken: string
}

export interface DownloadWhatsAppMediaArgs {
  mediaId: string
  accessToken: string
}

const MEDIA_DOWNLOAD_ATTEMPTS = 5
const MEDIA_REDIRECT_LIMIT = 5

/** Meta's lookaside CDN 500s when many voice notes fetch at once.
 *  Two in-flight downloads + retries is the throughput/reliability
 *  trade-off that still lets overlapping customers complete. */
export const META_MEDIA_DOWNLOAD_CONCURRENCY = 2

/**
 * lookaside.fbsbx.com 500s (or 302s to /unsupportedbrowser) unless the
 * client looks like curl. A custom product UA is treated as an
 * unsupported browser.
 */
export const META_MEDIA_DOWNLOAD_USER_AGENT = 'curl/7.64.1'

function isRetryableMediaStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function isHtmlContentType(contentType: string | null): boolean {
  return (contentType || '').toLowerCase().includes('text/html')
}

const mediaDownloadGate = createSemaphore(META_MEDIA_DOWNLOAD_CONCURRENCY)

function mediaHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': META_MEDIA_DOWNLOAD_USER_AGENT,
  }
}

/**
 * Follow lookaside redirects ourselves so the Bearer token is not
 * stripped on a cross-origin 302 (fetch's default).
 */
async function fetchLookaside(
  downloadUrl: string,
  accessToken: string,
): Promise<Response> {
  let url = downloadUrl
  for (let hop = 0; hop <= MEDIA_REDIRECT_LIMIT; hop++) {
    const response = await fetch(url, {
      headers: mediaHeaders(accessToken),
      redirect: 'manual',
    })
    const status = response.status
    if (status >= 300 && status < 400) {
      const location = response.headers.get('location')
      await response.arrayBuffer().catch(() => undefined)
      if (!location) {
        throw new Error(`Media download failed: ${status}`)
      }
      url = new URL(location, url).toString()
      continue
    }
    return response
  }
  throw new Error('Media download failed: too many redirects')
}

async function readLookasideBody(
  response: Response,
): Promise<{ buffer: Buffer; contentType: string }> {
  const contentType =
    response.headers.get('content-type') || 'application/octet-stream'
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined)
    throw new Error(`Media download failed: ${response.status}`)
  }
  if (isHtmlContentType(contentType)) {
    await response.arrayBuffer().catch(() => undefined)
    throw new Error('Media download failed: HTML response')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, contentType }
}

async function downloadMediaOnce(
  args: DownloadMediaArgs,
): Promise<{ buffer: Buffer; contentType: string }> {
  const { downloadUrl, accessToken } = args
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= MEDIA_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const response = await fetchLookaside(downloadUrl, accessToken)
      return await readLookasideBody(response)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const statusMatch = lastError.message.match(/Media download failed: (\d+)/)
      const status = statusMatch ? Number(statusMatch[1]) : 0
      const retryable =
        lastError.message.includes('HTML response') ||
        isRetryableMediaStatus(status) ||
        status === 0
      if (!retryable || attempt === MEDIA_DOWNLOAD_ATTEMPTS) {
        throw lastError
      }
      const backoffMs = 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200)
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError ?? new Error('Media download failed')
}

/**
 * Fetch the binary bytes for a media URL obtained from getMediaUrl.
 * Step two of the media-proxy flow.
 *
 * Overlapping voice notes share one WhatsApp token; Meta's CDN returns
 * 500 if we stampede it. Callers are queued (small concurrency) and
 * 5xx/429 responses are retried with backoff so every customer still
 * gets a transcript instead of a dropped note.
 */
export async function downloadMedia(
  args: DownloadMediaArgs
): Promise<{ buffer: Buffer; contentType: string }> {
  return mediaDownloadGate.run(() => downloadMediaOnce(args))
}

/**
 * Resolve a WhatsApp media id to bytes. Refreshes the short-lived
 * lookaside URL on every retry — Meta expires those URLs in ~5 minutes,
 * so reusing one 500ing link is a dead end.
 */
export async function downloadWhatsAppMedia(
  args: DownloadWhatsAppMediaArgs,
): Promise<{
  buffer: Buffer
  contentType: string
  mimeType: string
  fileSize: number | null
}> {
  return mediaDownloadGate.run(async () => {
    let lastError: Error | null = null
    for (let attempt = 1; attempt <= MEDIA_DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        const info = await getMediaUrl({
          mediaId: args.mediaId,
          accessToken: args.accessToken,
        })
        const response = await fetchLookaside(info.url, args.accessToken)
        const downloaded = await readLookasideBody(response)
        return {
          ...downloaded,
          mimeType: info.mimeType,
          fileSize: info.fileSize,
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt === MEDIA_DOWNLOAD_ATTEMPTS) throw lastError
        const backoffMs =
          400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 200)
        await new Promise((resolve) => setTimeout(resolve, backoffMs))
      }
    }
    throw lastError ?? new Error('Media download failed')
  })
}

// ============================================================
// Calling API (user-initiated WebRTC)
// ============================================================

export interface CallSettingsCalling {
  status?: 'ENABLED' | 'DISABLED'
  call_icon_visibility?: 'DEFAULT' | 'DISABLE_ALL'
  call_hours?: {
    status?: 'ENABLED' | 'DISABLED'
    timezone_id?: string
    weekly_operating_hours?: Array<{
      day_of_week: string
      open_time: string
      close_time: string
    }>
  }
}

export interface GetCallSettingsArgs {
  phoneNumberId: string
  accessToken: string
}

export async function getCallSettings(
  args: GetCallSettingsArgs,
): Promise<{ calling?: CallSettingsCalling }> {
  const { phoneNumberId, accessToken } = args
  const url = `${META_API_BASE}/${phoneNumberId}/settings`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta call settings error: ${response.status}`)
  }
  return response.json() as Promise<{ calling?: CallSettingsCalling }>
}

export interface UpdateCallSettingsArgs {
  phoneNumberId: string
  accessToken: string
  calling: CallSettingsCalling
}

export async function updateCallSettings(
  args: UpdateCallSettingsArgs,
): Promise<void> {
  const { phoneNumberId, accessToken, calling } = args
  const url = `${META_API_BASE}/${phoneNumberId}/settings`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ calling }),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta call settings error: ${response.status}`)
  }
}

export type CallGraphAction = 'pre_accept' | 'accept' | 'reject' | 'terminate'

export interface CallRecordingPayload {
  status: 'ENABLED' | 'DISABLED'
  purpose?: string
  announcement_language?: string
}

export interface CallActionArgs {
  phoneNumberId: string
  accessToken: string
  callId: string
  action: CallGraphAction
  session?: { sdpType: 'answer' | 'offer'; sdp: string }
  /** Official Meta call recording. Docs: send on `accept` only, not `pre_accept`. */
  recording?: CallRecordingPayload
}

export async function callAction(args: CallActionArgs): Promise<void> {
  const { phoneNumberId, accessToken, callId, action, session, recording } = args
  const url = `${META_API_BASE}/${phoneNumberId}/calls`
  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    call_id: callId,
    action,
  }
  if (session) {
    body.session = { sdp_type: session.sdpType, sdp: session.sdp }
  }
  if (recording) {
    body.recording = recording
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta calling API error: ${response.status}`)
  }
}

async function postWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  body: Record<string, unknown>,
): Promise<MetaSendResult> {
  const response = await fetch(`${META_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { messages?: { id: string }[] }
  const messageId = data.messages?.[0]?.id
  if (!messageId) throw new Error('Meta API returned no message id')
  return { messageId }
}

export interface SendInteractiveProductArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  productRetailerId: string
  bodyText: string
  footerText?: string
}

export async function sendInteractiveProduct(
  args: SendInteractiveProductArgs,
): Promise<MetaSendResult> {
  validateInteractiveBody(args.bodyText)
  const catalogId = args.catalogId.trim()
  const productRetailerId = args.productRetailerId.trim()
  if (!catalogId || !productRetailerId) {
    throw new Error('Native product messages need catalog_id and product_retailer_id')
  }
  const interactive: Record<string, unknown> = {
    type: 'product',
    body: { text: args.bodyText },
    action: {
      catalog_id: catalogId,
      product_retailer_id: productRetailerId,
    },
  }
  if (args.footerText?.trim()) interactive.footer = { text: args.footerText.trim() }
  return postWhatsAppMessage(args.phoneNumberId, args.accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'interactive',
    interactive,
  })
}

export interface SendInteractiveProductListArgs {
  phoneNumberId: string
  accessToken: string
  to: string
  catalogId: string
  headerText: string
  bodyText: string
  footerText?: string
  productRetailerIds: string[]
  sectionTitle?: string
}

export async function sendInteractiveProductList(
  args: SendInteractiveProductListArgs,
): Promise<MetaSendResult> {
  validateInteractiveBody(args.bodyText)
  const header = args.headerText.trim()
  if (!header) throw new Error('product_list messages need a header')
  const catalogId = args.catalogId.trim()
  const ids = [...new Set(args.productRetailerIds.map((id) => id.trim()).filter(Boolean))]
  if (!catalogId || ids.length === 0) {
    throw new Error('product_list needs catalog_id and at least one retailer id')
  }
  const interactive: Record<string, unknown> = {
    type: 'product_list',
    header: { type: 'text', text: header.slice(0, INTERACTIVE_LIMITS.headerTextMaxLength) },
    body: { text: args.bodyText },
    action: {
      catalog_id: catalogId,
      sections: [
        {
          title: (args.sectionTitle || 'Products').slice(0, 24),
          product_items: ids.slice(0, 30).map((id) => ({ product_retailer_id: id })),
        },
      ],
    },
  }
  if (args.footerText?.trim()) interactive.footer = { text: args.footerText.trim() }
  return postWhatsAppMessage(args.phoneNumberId, args.accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'interactive',
    interactive,
  })
}

export async function sendCatalogMessage(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  footerText?: string
}): Promise<MetaSendResult> {
  validateInteractiveBody(args.bodyText)
  const interactive: Record<string, unknown> = {
    type: 'catalog_message',
    body: { text: args.bodyText },
    action: { name: 'catalog' },
  }
  if (args.footerText?.trim()) interactive.footer = { text: args.footerText.trim() }
  return postWhatsAppMessage(args.phoneNumberId, args.accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'interactive',
    interactive,
  })
}

/**
 * Fields Meta's India address form renders. Used as the key space for
 * prefill `values` and inline `validation_errors`.
 */
export const ADDRESS_MESSAGE_FIELDS = [
  'name',
  'phone_number',
  'in_pin_code',
  'house_number',
  'floor_number',
  'tower_number',
  'building_name',
  'address',
  'landmark_area',
  'city',
  'state',
] as const

export type AddressMessageField = (typeof ADDRESS_MESSAGE_FIELDS)[number]

export type AddressMessageValues = Partial<Record<AddressMessageField, string>>

/**
 * Send the native WhatsApp address form (India only). The customer taps
 * the CTA, fills a structured form inside WhatsApp, and submits — the
 * answer arrives as an `nfm_reply` inbound message rather than free text.
 *
 * `values` prefills the form (a known Shopify address, or the customer's
 * previous attempt when re-asking); `validationErrors` renders inline
 * errors under those same fields after a server-side check fails.
 *
 * Clients that don't support the form get nothing visible — Meta sends a
 * `failed` status with error 1026 instead, which callers use to fall back
 * to a plain-text address prompt.
 */
export async function sendAddressMessage(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  bodyText: string
  values?: AddressMessageValues
  validationErrors?: AddressMessageValues
  savedAddresses?: Array<{ id: string; value: AddressMessageValues }>
}): Promise<MetaSendResult> {
  validateInteractiveBody(args.bodyText)
  const parameters: Record<string, unknown> = { country: 'IN' }
  const values = compactAddressFields(args.values)
  if (values) parameters.values = values
  const validationErrors = compactAddressFields(args.validationErrors)
  if (validationErrors) parameters.validation_errors = validationErrors
  const saved = (args.savedAddresses ?? [])
    .map((entry) => ({ id: entry.id.trim(), value: compactAddressFields(entry.value) }))
    .filter((entry): entry is { id: string; value: AddressMessageValues } =>
      Boolean(entry.id && entry.value),
    )
  if (saved.length > 0) parameters.saved_addresses = saved

  return postWhatsAppMessage(args.phoneNumberId, args.accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'interactive',
    interactive: {
      type: 'address_message',
      body: { text: args.bodyText },
      action: { name: 'address_message', parameters },
    },
  })
}

function compactAddressFields(
  input: AddressMessageValues | undefined,
): AddressMessageValues | null {
  if (!input) return null
  const out: AddressMessageValues = {}
  for (const field of ADDRESS_MESSAGE_FIELDS) {
    const value = input[field]?.trim()
    if (value) out[field] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

export async function sendOrderDetailsMessage(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  interactive: Record<string, unknown>
}): Promise<MetaSendResult> {
  return postWhatsAppMessage(args.phoneNumberId, args.accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'interactive',
    interactive: args.interactive,
  })
}

export const ORDER_STATUS_VALUES = [
  'processing',
  'partially_shipped',
  'shipped',
  'completed',
  'canceled',
] as const

export type WhatsAppOrderStatus = (typeof ORDER_STATUS_VALUES)[number]

export async function sendOrderStatusMessage(args: {
  phoneNumberId: string
  accessToken: string
  to: string
  referenceId: string
  status: WhatsAppOrderStatus
  bodyText: string
  description?: string
}): Promise<MetaSendResult> {
  validateInteractiveBody(args.bodyText)
  if (!ORDER_STATUS_VALUES.includes(args.status)) {
    throw new Error(`Unsupported order_status "${args.status}"`)
  }
  const order: Record<string, unknown> = { status: args.status }
  if (args.description?.trim()) {
    order.description = args.description.trim().slice(0, 120)
  }
  return postWhatsAppMessage(args.phoneNumberId, args.accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'interactive',
    interactive: {
      type: 'order_status',
      body: { text: args.bodyText },
      action: {
        name: 'review_order',
        parameters: {
          reference_id: args.referenceId,
          order,
        },
      },
    },
  })
}

export interface PaymentLookupResult {
  reference_id: string
  status: 'pending' | 'captured'
  transactions: Array<{
    id?: string
    pg_transaction_id?: string
    type?: string
    status?: string
    method?: { type?: string }
  }>
}

function asPaymentRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function looksLikePaymentRecord(row: Record<string, unknown>): boolean {
  return Boolean(
    row.reference_id ||
      row.status ||
      Array.isArray(row.transactions),
  )
}

/**
 * Meta usually wraps lookup in `{ payments: [...] }`. Cloud API
 * sometimes returns the payment at the top level or as `{ data: [...] }`.
 */
export function parseWhatsAppPaymentLookup(
  data: unknown,
  fallbackReferenceId: string,
): PaymentLookupResult | null {
  const root = asPaymentRecord(data)
  if (!root) return null

  const candidates: Record<string, unknown>[] = []
  const wrapped = Array.isArray(root.payments) ? root.payments[0] : null
  const wrappedRecord = asPaymentRecord(wrapped)
  if (wrappedRecord && looksLikePaymentRecord(wrappedRecord)) {
    candidates.push(wrappedRecord)
  }
  const listed = Array.isArray(root.data) ? root.data[0] : null
  const listedRecord = asPaymentRecord(listed)
  if (listedRecord && looksLikePaymentRecord(listedRecord)) {
    candidates.push(listedRecord)
  }
  if (looksLikePaymentRecord(root) && !Array.isArray(root.payments)) {
    candidates.push(root)
  }

  const payment = candidates[0]
  if (!payment) return null

  const transactions = Array.isArray(payment.transactions)
    ? (payment.transactions as PaymentLookupResult['transactions'])
    : []
  const raw = String(payment.status ?? '').toLowerCase()
  const txnCaptured = transactions.some((t) => {
    const s = (t.status ?? '').toLowerCase()
    return s === 'success' || s === 'captured'
  })
  const status =
    raw === 'captured' || raw === 'success' || raw === 'paid' || txnCaptured
      ? 'captured'
      : 'pending'
  return {
    reference_id: String(payment.reference_id ?? fallbackReferenceId),
    status,
    transactions,
  }
}

export async function lookupWhatsAppPayment(args: {
  phoneNumberId: string
  accessToken: string
  configurationName: string
  referenceId: string
}): Promise<PaymentLookupResult | null> {
  const config = encodeURIComponent(args.configurationName.trim())
  const ref = encodeURIComponent(args.referenceId.trim())
  const url = `${META_API_BASE}/${args.phoneNumberId}/payments/${config}/${ref}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${args.accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Payment lookup failed (${response.status})`)
  }
  const data: unknown = await response.json()
  return parseWhatsAppPaymentLookup(data, args.referenceId)
}

export async function refundWhatsAppPayment(args: {
  phoneNumberId: string
  accessToken: string
  referenceId: string
  paymentConfigId: string
  valuePaise: number
  speed?: 'normal' | 'instant'
}): Promise<{ id: string; status: string }> {
  const response = await fetch(
    `${META_API_BASE}/${args.phoneNumberId}/payments_refund`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference_id: args.referenceId,
        speed: args.speed ?? 'normal',
        payment_config_id: args.paymentConfigId,
        amount: {
          currency: 'INR',
          value: String(Math.max(1, Math.round(args.valuePaise))),
          offset: '100',
        },
      }),
    },
  )
  if (!response.ok) {
    await throwMetaError(response, `Refund failed (${response.status})`)
  }
  const data = (await response.json()) as { id?: string; status?: string }
  return { id: data.id ?? '', status: data.status ?? 'pending' }
}
