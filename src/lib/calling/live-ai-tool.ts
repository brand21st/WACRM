import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { loadShopifyConfig } from '@/lib/shopify'
import { loadCommerceSettings } from '@/lib/shopify/commerce-config'
import { nativeCommerceEnabled } from '@/lib/commerce/types'
import { persistCallTurnMessage } from '@/lib/calling/persist-call-turn'
import { bindShopifyTools, sendProductCards } from '@/lib/ai/auto-reply'
import { loadLiveAiCall } from '@/lib/calling/live-ai-realtime'
import {
  SEARCH_CUSTOMER_MEMORY_TOOL,
  SEARCH_KNOWLEDGE_TOOL,
  TRANSFER_TO_HUMAN_TOOL,
} from '@/lib/calling/live-ai-constants'
import {
  isLiveAiNoiseTranscript,
  loadLiveAiCustomerMemory,
  searchLiveAiMemory,
} from '@/lib/calling/live-ai-memory'
import { loadAiConfig } from '@/lib/ai/config'
import {
  emptyContactMemory,
  loadContactMemory,
  persistLanguageLock,
} from '@/lib/ai/chat-memory'
import {
  resolveLanguageLock,
  storedLanguageLock,
  type ChatLanguageLock,
} from '@/lib/ai/language-lock'
import { liveAiHandoffSpoken } from '@/lib/calling/live-ai-speech-language'
import type { ShopifyProductCard } from '@/lib/shopify'

export type LiveAiToolTranscriptRole = 'customer' | 'bot'

export type LiveAiToolResult = {
  output: string
  handoff: boolean
  spoken?: string
}

export type LiveAiTranscriptPersistResult = {
  persisted: boolean
  lock: ChatLanguageLock | null
  changed: boolean
}

const EMPTY_TRANSCRIPT_PERSIST: LiveAiTranscriptPersistResult = {
  persisted: false,
  lock: null,
  changed: false,
}

export async function persistLiveAiTranscript(args: {
  db?: SupabaseClient
  accountId: string
  callId: string
  role: LiveAiToolTranscriptRole
  text: string
  itemId?: string
}): Promise<LiveAiTranscriptPersistResult> {
  const db = args.db ?? supabaseAdmin()
  const call = await loadLiveAiCall({ db, accountId: args.accountId, callId: args.callId })
  const text = args.text.trim()
  if (!text || !call.conversation_id || isLiveAiNoiseTranscript(text)) {
    return EMPTY_TRANSCRIPT_PERSIST
  }
  await persistCallTurnMessage(db, {
    conversationId: call.conversation_id,
    direction: args.role === 'customer' ? 'in' : 'out',
    callId: call.id,
    text,
    seq: args.itemId,
  })
  if (args.role !== 'customer' || !call.contact_id) {
    return { persisted: true, lock: null, changed: false }
  }

  const memory = await loadContactMemory(db, args.accountId, call.contact_id).catch((err) => {
    console.warn('[live-ai] loadContactMemory failed:', err)
    return emptyContactMemory()
  })
  const resolved = resolveLanguageLock({
    customerText: text,
    stored: memory.facts,
  })
  if (!resolved.lock) {
    return { persisted: true, lock: null, changed: false }
  }
  if (!resolved.changed) {
    return { persisted: true, lock: resolved.lock, changed: false }
  }
  try {
    await persistLanguageLock({
      db,
      accountId: args.accountId,
      contactId: call.contact_id,
      conversationId: call.conversation_id,
      lock: resolved.lock,
      existing: memory,
    })
  } catch (err) {
    console.warn('[live-ai] persistLanguageLock failed:', err)
  }
  return { persisted: true, lock: resolved.lock, changed: true }
}

export async function executeLiveAiTool(args: {
  db?: SupabaseClient
  accountId: string
  userId: string
  callId: string
  name: string
  arguments: Record<string, unknown>
}): Promise<LiveAiToolResult> {
  const db = args.db ?? supabaseAdmin()
  const call = await loadLiveAiCall({ db, accountId: args.accountId, callId: args.callId })

  if (args.name === TRANSFER_TO_HUMAN_TOOL) {
    const memory = call.contact_id
      ? await loadContactMemory(db, args.accountId, call.contact_id).catch((err) => {
          console.warn('[live-ai] loadContactMemory failed:', err)
          return emptyContactMemory()
        })
      : emptyContactMemory()
    const spoken = liveAiHandoffSpoken(storedLanguageLock(memory.facts))
    if (call.conversation_id) {
      await persistCallTurnMessage(db, {
        conversationId: call.conversation_id,
        direction: 'out',
        callId: call.id,
        text: spoken,
        seq: 'handoff',
      })
    }
    return { output: JSON.stringify({ ok: true }), handoff: true, spoken }
  }

  const config = await loadAiConfig(db, args.accountId)
  if (!config) {
    throw Object.assign(new Error('Live AI is not configured'), {
      status: 400,
      code: 'live_ai_not_ready',
    })
  }

  if (args.name === SEARCH_KNOWLEDGE_TOOL) {
    const query = typeof args.arguments.query === 'string' ? args.arguments.query : ''
    const excerpts = await retrieveKnowledge(db, args.accountId, config, query)
    return {
      output: JSON.stringify({ excerpts }),
      handoff: false,
    }
  }

  if (args.name === SEARCH_CUSTOMER_MEMORY_TOOL) {
    const query = typeof args.arguments.query === 'string' ? args.arguments.query : ''
    if (!call.contact_id || !call.conversation_id) {
      return { output: JSON.stringify({ hits: [] }), handoff: false }
    }
    const memory = await loadLiveAiCustomerMemory({
      db,
      accountId: args.accountId,
      contactId: call.contact_id,
      conversationId: call.conversation_id,
    })
    const hits = searchLiveAiMemory(memory, query)
    return {
      output: JSON.stringify({ hits }),
      handoff: false,
    }
  }

  const shopify = await loadShopifyConfig(db, args.accountId).catch((err) => {
    console.error('[live-ai] loadShopifyConfig failed:', err)
    return null
  })
  if (!shopify) {
    return {
      output: JSON.stringify({ error: 'Shopify is not connected.' }),
      handoff: false,
    }
  }

  const { data: contactRow } = await db
    .from('contacts')
    .select('phone')
    .eq('id', call.contact_id)
    .eq('account_id', args.accountId)
    .maybeSingle()

  const productCards: ShopifyProductCard[] = []
  const commerce = await loadCommerceSettings(db, args.accountId).catch(() => null)
  const bound = bindShopifyTools(
    db,
    shopify,
    contactRow?.phone ?? null,
    productCards,
    {
      imageTurn: false,
      nativeCommerce: nativeCommerceEnabled({
        metaCatalogId: commerce?.metaCatalogId ?? shopify.metaCatalogId,
        waPaymentConfigurationName: commerce?.waPaymentConfigurationName,
      }),
      retailerIdSource: commerce?.retailerIdSource,
    },
  )
  if (!bound.executeTool) {
    return {
      output: JSON.stringify({ error: 'Shopify tools are unavailable.' }),
      handoff: false,
    }
  }

  const output = await bound.executeTool(args.name, args.arguments)
  if (productCards.length > 0 && call.conversation_id && call.contact_id) {
    await sendProductCards(
      {
        accountId: args.accountId,
        userId: args.userId,
        conversationId: call.conversation_id,
        contactId: call.contact_id,
      },
      productCards,
      shopify,
    )
  }
  return { output, handoff: false }
}

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return { raw }
    }
  }
  return {}
}
