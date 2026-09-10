import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { loadContactMemory } from './chat-memory'
import { resolveLanguageLock } from './language-lock'
import { generateReply } from './generate'
import { spokenRewrite } from './spoken-rewrite'
import { hasInformalCustomerAddress } from './customer-address'
import { engineSendText } from '@/lib/flows/meta-send'
import { customerServiceExpiresAt } from '@/lib/inbox/session-window'
import {
  enqueueAiConversationFollowUp,
  removeAiConversationFollowUp,
} from '@/lib/queue/enqueue'
import {
  FOLLOW_UP_DELAY_DEFAULT_MINUTES,
  followUpDelayMinutesOrDefault,
} from './follow-up-delay'
import {
  hasOpenCommercePending,
  loadCommerceTurn,
} from './commerce-turn'
import {
  buildFollowUpSystemPrompt,
  followUpMentionsUngroundedFacts,
  hasMeaningfulFollowUpContext,
  isExplicitFollowUpDecline,
  parseFollowUpGeneration,
  transcriptText,
} from './follow-up-prompt'
import {
  emptyShoppingContext,
  formatSalesSnapshot,
  loadShoppingContext,
} from '@/lib/catalog/intelligence/shopping-context'
import { parseProductFocus } from '@/lib/shopify/product-focus'
import {
  catalogOnlyStoreConfig,
  getProductFromCatalog,
  loadShopifyConfig,
} from '@/lib/shopify'
import { loadCommerceSettings } from '@/lib/shopify/commerce-config'
import { formatCurrentProductFacts } from '@/lib/shopify/product-facts'
import type { AiConfig } from './types'

export type FollowUpSkipReason =
  | 'disabled'
  | 'no_ai_reply'
  | 'customer_replied'
  | 'human_takeover'
  | 'closed'
  | 'already_sent'
  | 'no_context'
  | 'ai_skip'
  | 'ungrounded'
  | 'session_window_expired'
  | 'generation_failure'
  | 'send_failure'
  | 'account_mismatch'
  | 'not_due'
  | 'purchased'
  | 'declined'

type FollowUpRow = {
  id: string
  account_id: string
  conversation_id: string
  triggering_message_id: string
  run_at: string
  status: string
}

export async function cancelConversationFollowUp(args: {
  db?: SupabaseClient
  accountId: string
  conversationId: string
}): Promise<void> {
  const db = args.db ?? supabaseAdmin()
  const { data, error } = await db
    .from('conversation_follow_ups')
    .update({ status: 'cancelled', skip_reason: 'customer_replied' })
    .eq('account_id', args.accountId)
    .eq('conversation_id', args.conversationId)
    .eq('status', 'pending')
    .select('id')
  if (error) {
    console.warn('[follow-up] cancel failed:', error.message)
    return
  }
  for (const row of data ?? []) {
    await removeAiConversationFollowUp(String(row.id)).catch(() => undefined)
  }
}

export async function scheduleConversationFollowUp(args: {
  db?: SupabaseClient
  accountId: string
  conversationId: string
  config?: AiConfig | null
}): Promise<void> {
  const db = args.db ?? supabaseAdmin()
  const config =
    args.config ??
    (await loadAiConfig(db, args.accountId).catch((err) => {
      console.warn('[follow-up] loadAiConfig failed:', err)
      return null
    }))
  if (!config?.autoReplyEnabled) {
    console.info('[follow-up] skip schedule', { reason: 'disabled' })
    return
  }

  const eligible = await loadEligibleConversation(db, args.accountId, args.conversationId)
  if (!eligible.ok) {
    console.info('[follow-up] skip schedule', { reason: eligible.reason })
    return
  }

  const commerce = await loadCommerceTurn(
    db,
    args.accountId,
    eligible.contactId,
    args.conversationId,
  ).catch(() => null)
  const commercePending = hasOpenCommercePending(commerce)
  if (!config.followUpEnabled && !commercePending) {
    console.info('[follow-up] skip schedule', { reason: 'disabled' })
    return
  }

  const trigger = await latestAiOutboundAfterCustomer(
    db,
    args.conversationId,
    args.accountId,
  )
  if (!trigger) {
    console.info('[follow-up] skip schedule', { reason: 'no_ai_reply' })
    return
  }

  const { data: alreadySent } = await db
    .from('conversation_follow_ups')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('conversation_id', args.conversationId)
    .eq('triggering_message_id', trigger.id)
    .eq('status', 'sent')
    .maybeSingle()
  if (alreadySent) {
    console.info('[follow-up] skip schedule', { reason: 'already_sent' })
    return
  }

  await cancelConversationFollowUp({
    db,
    accountId: args.accountId,
    conversationId: args.conversationId,
  })

  const merchantDelay = followUpDelayMinutesOrDefault(config.followUpDelayMinutes)
  const delayMinutes = commercePending
    ? Math.max(FOLLOW_UP_DELAY_DEFAULT_MINUTES, merchantDelay)
    : merchantDelay
  const runAt = new Date(Date.now() + delayMinutes * 60_000).toISOString()
  const { data: inserted, error } = await db
    .from('conversation_follow_ups')
    .insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      triggering_message_id: trigger.id,
      run_at: runAt,
      status: 'pending',
    })
    .select('id')
    .maybeSingle()
  if (error || !inserted?.id) {
    console.warn('[follow-up] insert pending failed:', error?.message)
    return
  }

  const queued = await enqueueAiConversationFollowUp(
    {
      accountId: args.accountId,
      conversationId: args.conversationId,
      followUpId: String(inserted.id),
      triggeringMessageId: trigger.id,
    },
    delayMinutes * 60_000,
  )
  console.info('[follow-up] scheduled', {
    followUpId: inserted.id,
    delayMinutes,
    queued,
  })
}

export async function processConversationFollowUp(args: {
  accountId: string
  conversationId: string
  followUpId: string
  triggeringMessageId: string
}): Promise<void> {
  const db = supabaseAdmin()
  const claimed = await claimFollowUp(db, args)
  if (!claimed) {
    console.info('[follow-up] skip', { reason: 'already_claimed' })
    return
  }

  try {
    if (new Date(claimed.run_at).getTime() > Date.now() + 2_000) {
      await restorePending(db, claimed.id, 'not_due')
      return
    }
    if (claimed.account_id !== args.accountId) {
      await finishSkip(db, claimed.id, 'account_mismatch')
      return
    }

    const config = await loadAiConfig(db, args.accountId)
    if (!config?.autoReplyEnabled) {
      await finishSkip(db, claimed.id, 'disabled')
      return
    }

    const eligible = await loadEligibleConversation(
      db,
      args.accountId,
      args.conversationId,
    )
    if (!eligible.ok) {
      await finishSkip(db, claimed.id, eligible.reason)
      return
    }

    const commerce = await loadCommerceTurn(
      db,
      args.accountId,
      eligible.contactId,
      args.conversationId,
    ).catch(() => null)
    const commercePending = hasOpenCommercePending(commerce)
    if (!config.followUpEnabled && !commercePending) {
      await finishSkip(db, claimed.id, 'disabled')
      return
    }

    const silent = await customerStillSilent(
      db,
      args.conversationId,
      claimed.triggering_message_id,
    )
    if (!silent.ok) {
      await finishSkip(db, claimed.id, silent.reason)
      return
    }

    const lastCustomerAt = silent.lastCustomerAt
    const expiresAt = customerServiceExpiresAt(lastCustomerAt)
    if (!expiresAt || expiresAt.getTime() <= Date.now()) {
      await finishSkip(db, claimed.id, 'session_window_expired')
      return
    }

    const messages = await buildConversationContext(db, args.conversationId)
    if (!hasMeaningfulFollowUpContext(messages, { commercePending })) {
      await finishSkip(db, claimed.id, 'no_context')
      return
    }

    const lastCustomerText =
      messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''
    if (isExplicitFollowUpDecline(lastCustomerText)) {
      await finishSkip(db, claimed.id, 'declined')
      return
    }

    if (
      await contactAlreadyPurchased(db, args.accountId, eligible.contactId, args.conversationId)
    ) {
      await finishSkip(db, claimed.id, 'purchased')
      return
    }

    const memory = await loadContactMemory(
      db,
      args.accountId,
      eligible.contactId,
    ).catch(() => null)
    const shopping = await loadShoppingContext(
      db,
      args.accountId,
      eligible.contactId,
    ).catch(() => null)
    const productFocus = parseProductFocus(eligible.productFocus)
    const salesSnapshot = formatSalesSnapshot(
      shopping ?? emptyShoppingContext(),
      productFocus,
      commerce,
    )
    const replyLanguage = resolveLanguageLock({
      stored: memory?.facts ?? null,
      customerText: lastCustomerText,
    }).lock
    const productFacts = await loadFocusedProductFacts(
      db,
      args.accountId,
      productFocus,
    )

    let generated
    try {
      const result = await generateReply({
        config,
        systemPrompt: buildFollowUpSystemPrompt({
          replyLanguage,
          salesSnapshot,
          productFacts,
        }),
        messages,
        replyLanguage,
        skipSpokenRewrite: true,
      })
      generated = parseFollowUpGeneration(result.text)
    } catch (err) {
      console.error('[follow-up] generation failed:', err)
      await finishSkip(db, claimed.id, 'generation_failure')
      return
    }

    if (generated.action !== 'send' || !generated.message) {
      await finishSkip(db, claimed.id, 'ai_skip')
      return
    }

    if (hasInformalCustomerAddress(generated.message)) {
      generated = {
        ...generated,
        message: await spokenRewrite({
          config,
          draft: generated.message,
          customerText: lastCustomerText,
          replyLanguage,
          fixInformalAddress: true,
        }),
      }
    }

    const context = [transcriptText(messages), salesSnapshot].filter(Boolean).join('\n')
    if (followUpMentionsUngroundedFacts(generated.message, context)) {
      await finishSkip(db, claimed.id, 'ungrounded')
      return
    }

    try {
      await engineSendText({
        accountId: args.accountId,
        userId: eligible.userId,
        conversationId: args.conversationId,
        contactId: eligible.contactId,
        text: generated.message.slice(0, 1024),
        aiGenerated: true,
      })
    } catch (err) {
      console.error('[follow-up] send failed:', err)
      await finishSkip(db, claimed.id, 'send_failure')
      return
    }

    const { error } = await db
      .from('conversation_follow_ups')
      .update({ status: 'sent', skip_reason: null })
      .eq('id', claimed.id)
      .eq('account_id', args.accountId)
    if (error) {
      console.warn('[follow-up] mark sent failed:', error.message)
    } else {
      console.info('[follow-up] sent', { followUpId: claimed.id })
    }
  } catch (err) {
    console.error('[follow-up] process failed:', err)
    await finishSkip(db, claimed.id, 'generation_failure')
  }
}

export async function drainDueConversationFollowUps(
  db: SupabaseClient,
  limit = 20,
): Promise<{ processed: number }> {
  const { data: due, error } = await db
    .from('conversation_follow_ups')
    .select('id, account_id, conversation_id, triggering_message_id')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(limit)
  if (error) throw error
  let processed = 0
  for (const row of due ?? []) {
    await processConversationFollowUp({
      accountId: String(row.account_id),
      conversationId: String(row.conversation_id),
      followUpId: String(row.id),
      triggeringMessageId: String(row.triggering_message_id),
    })
    processed++
  }
  return { processed }
}

async function claimFollowUp(
  db: SupabaseClient,
  args: { accountId: string; followUpId: string },
): Promise<FollowUpRow | null> {
  const { data, error } = await db
    .from('conversation_follow_ups')
    .update({ status: 'sending' })
    .eq('id', args.followUpId)
    .eq('account_id', args.accountId)
    .eq('status', 'pending')
    .select(
      'id, account_id, conversation_id, triggering_message_id, run_at, status',
    )
    .maybeSingle()
  if (error) {
    console.warn('[follow-up] claim failed:', error.message)
    return null
  }
  return (data as FollowUpRow | null) ?? null
}

async function finishSkip(
  db: SupabaseClient,
  id: string,
  reason: FollowUpSkipReason,
): Promise<void> {
  console.info('[follow-up] skip', { reason, followUpId: id })
  await db
    .from('conversation_follow_ups')
    .update({ status: 'skipped', skip_reason: reason })
    .eq('id', id)
}

async function restorePending(
  db: SupabaseClient,
  id: string,
  reason: FollowUpSkipReason,
): Promise<void> {
  console.info('[follow-up] skip', { reason, followUpId: id })
  await db
    .from('conversation_follow_ups')
    .update({ status: 'pending', skip_reason: null })
    .eq('id', id)
    .eq('status', 'sending')
}

async function loadFocusedProductFacts(
  db: SupabaseClient,
  accountId: string,
  productFocus: ReturnType<typeof parseProductFocus>,
): Promise<string> {
  if (!productFocus?.handle) return ''
  try {
    const shopify = await loadShopifyConfig(db, accountId).catch(() => null)
    const commerce = await loadCommerceSettings(db, accountId).catch(() => null)
    const catalogConfig =
      shopify ??
      catalogOnlyStoreConfig(accountId, {
        metaCatalogId: commerce?.metaCatalogId ?? null,
      })
    const hit = await getProductFromCatalog(db, catalogConfig, productFocus.handle)
    if (!hit) return ''
    return formatCurrentProductFacts(hit, productFocus)
  } catch (err) {
    console.warn('[follow-up] focused product facts failed:', err)
    return ''
  }
}

async function loadEligibleConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<
  | {
      ok: true
      contactId: string
      userId: string
      productFocus?: unknown
    }
  | { ok: false; reason: FollowUpSkipReason }
> {
  const { data, error } = await db
    .from('conversations')
    .select(
      'id, account_id, contact_id, user_id, status, assigned_agent_id, ai_autoreply_disabled, ai_product_focus',
    )
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) return { ok: false, reason: 'account_mismatch' }
  if (data.status === 'closed') return { ok: false, reason: 'closed' }
  if (data.assigned_agent_id || data.ai_autoreply_disabled) {
    return { ok: false, reason: 'human_takeover' }
  }
  return {
    ok: true,
    contactId: String(data.contact_id),
    userId: String(data.user_id ?? ''),
    productFocus: (data as { ai_product_focus?: unknown }).ai_product_focus,
  }
}

async function latestAiOutboundAfterCustomer(
  db: SupabaseClient,
  conversationId: string,
  accountId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from('messages')
    .select('id, sender_type, created_at, ai_generated')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error || !data?.length) return null

  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!conv) return null

  const latest = data[0] as {
    id: string
    sender_type: string
    ai_generated?: boolean | null
  }
  if (latest.sender_type === 'agent') return null
  if (latest.sender_type !== 'bot') return null
  return { id: latest.id }
}

async function customerStillSilent(
  db: SupabaseClient,
  conversationId: string,
  triggeringMessageId: string,
): Promise<
  | { ok: true; lastCustomerAt: string }
  | { ok: false; reason: FollowUpSkipReason }
> {
  const { data: trigger, error: triggerErr } = await db
    .from('messages')
    .select('id, created_at')
    .eq('id', triggeringMessageId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (triggerErr || !trigger?.created_at) {
    return { ok: false, reason: 'no_ai_reply' }
  }

  const { data: laterCustomer } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .gt('created_at', trigger.created_at)
    .limit(1)
    .maybeSingle()
  if (laterCustomer) return { ok: false, reason: 'customer_replied' }

  const { data: laterAgent } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'agent')
    .gt('created_at', trigger.created_at)
    .limit(1)
    .maybeSingle()
  if (laterAgent) return { ok: false, reason: 'human_takeover' }

  const { data: lastCustomer } = await db
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!lastCustomer?.created_at) return { ok: false, reason: 'no_ai_reply' }

  return { ok: true, lastCustomerAt: String(lastCustomer.created_at) }
}

async function contactAlreadyPurchased(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const { data: contact } = await db
      .from('contacts')
      .select('wa_commerce_paid_at')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (contact && typeof contact === 'object') {
      const paid = (contact as { wa_commerce_paid_at?: unknown }).wa_commerce_paid_at
      if (typeof paid === 'string' && paid.trim()) return true
    }
  } catch {
    // Column or table may be missing in tests / older schemas.
  }

  try {
    const { data: orders } = await db
      .from('whatsapp_commerce_orders')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .limit(20)
    const rows = Array.isArray(orders) ? orders : []
    return rows.some((row) => {
      const status = String((row as { status?: unknown }).status ?? '').toLowerCase()
      return status === 'processing' || status === 'completed'
    })
  } catch {
    return false
  }
}
