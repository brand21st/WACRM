import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupCatalogProduct } from '../search/lookup'
import { getCatalogProductsByIds } from './facts'
import {
  parseCategoryHint,
  parseDislikes,
  parseOccasion,
  parseRecipient,
  parseRejectsShown,
  parseSelectsShown,
  parseShoppingRequirements,
  parseShownOrdinal,
} from './requirements'
import { deriveSalesStage, isComplementaryAsk } from './sales-stage'
import type {
  RecommendIntent,
  SalesStage,
  ShoppingContext,
  ShoppingRequirements,
} from './types'

const SHOWN_CAP = 8
const LIST_CAP = 12

export function emptyShoppingContext(
  stage: SalesStage = 'discovery',
): ShoppingContext {
  return {
    colors: [],
    dislikes: [],
    selectedIds: [],
    rejectedIds: [],
    shownIds: [],
    stage,
  }
}

export function parseShoppingFacts(raw: unknown): ShoppingContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyShoppingContext()
  }
  const row = raw as Record<string, unknown>
  const option =
    row.option && typeof row.option === 'object' && !Array.isArray(row.option)
      ? (row.option as { name?: unknown; value?: unknown })
      : null
  const optionValue =
    typeof option?.value === 'string' ? option.value.trim() : ''
  return {
    occasion: str(row.occasion),
    recipient: str(row.recipient),
    minPrice: num(row.minPrice),
    maxPrice: num(row.maxPrice),
    colors: stringList(row.colors),
    dislikes: stringList(row.dislikes),
    option: optionValue
      ? {
          name: typeof option?.name === 'string' ? option.name.trim() : undefined,
          value: optionValue,
        }
      : undefined,
    categoryHint: str(row.categoryHint),
    selectedIds: stringList(row.selectedIds, LIST_CAP),
    rejectedIds: stringList(row.rejectedIds, LIST_CAP),
    shownIds: stringList(row.shownIds, SHOWN_CAP),
    stage: isSalesStage(row.stage) ? row.stage : 'discovery',
  }
}

export function serializeShoppingContext(
  ctx: ShoppingContext,
): Record<string, unknown> {
  return {
    occasion: ctx.occasion,
    recipient: ctx.recipient,
    minPrice: ctx.minPrice,
    maxPrice: ctx.maxPrice,
    colors: ctx.colors,
    dislikes: ctx.dislikes,
    option: ctx.option,
    categoryHint: ctx.categoryHint,
    selectedIds: ctx.selectedIds,
    rejectedIds: ctx.rejectedIds,
    shownIds: ctx.shownIds,
    stage: ctx.stage,
  }
}

export async function loadShoppingContext(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null | undefined,
): Promise<ShoppingContext> {
  if (!contactId) return emptyShoppingContext()
  try {
    const { data, error } = await db
      .from('contact_ai_memory')
      .select('facts')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (error || !data) return emptyShoppingContext()
    const facts = (data as { facts?: { shopping?: unknown } }).facts
    return parseShoppingFacts(facts?.shopping)
  } catch {
    return emptyShoppingContext()
  }
}

export async function persistShoppingContext(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  shopping: ShoppingContext,
  conversationId?: string | null,
): Promise<void> {
  const { data, error } = await db
    .from('contact_ai_memory')
    .select('facts')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (error) throw error
  const facts =
    data?.facts && typeof data.facts === 'object' && !Array.isArray(data.facts)
      ? { ...(data.facts as Record<string, unknown>) }
      : {}
  facts.shopping = serializeShoppingContext(shopping)
  const { error: upsertErr } = await db.from('contact_ai_memory').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId ?? null,
      facts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'contact_id' },
  )
  if (upsertErr) throw upsertErr
}

export type ShoppingMergeInput = {
  accountId: string
  contactId?: string | null
  conversationId?: string | null
  text?: string | null
  previous?: ShoppingContext
  shownIds?: string[]
  selectedIds?: string[]
  rejectedIds?: string[]
  requirements?: ShoppingRequirements
  mode?: RecommendIntent | null
  seedId?: string | null
  hasCart?: boolean
  hasPendingCheckout?: boolean
  hasPaidOrder?: boolean
}

export async function mergeShoppingContext(
  db: SupabaseClient,
  input: ShoppingMergeInput,
): Promise<ShoppingContext> {
  const prev = input.previous ?? emptyShoppingContext()
  const text = input.text ?? ''
  const requirements = input.requirements ?? parseShoppingRequirements(text)

  const explicitDislikes = parseDislikes(text)
  const occasion = parseOccasion(text) ?? prev.occasion
  const recipient = parseRecipient(text) ?? prev.recipient
  const categoryHint = parseCategoryHint(text) ?? prev.categoryHint
  const color = colorFromRequirements(requirements)
  const colors = color
    ? uniq([color, ...prev.colors.filter((item) => item !== color)])
    : prev.colors

  const shownIds = await validateCatalogIds(
    db,
    input.accountId,
    [
      ...(input.shownIds ?? []),
      ...prev.shownIds,
    ].slice(0, SHOWN_CAP * 2),
  )

  const ordinal = parseShownOrdinal(text)
  const ordinalId =
    ordinal != null && shownIds[ordinal] ? [shownIds[ordinal]] : []
  const rejectLast = parseRejectsShown(text) && shownIds[0] ? [shownIds[0]] : []
  const selectLast =
    parseSelectsShown(text) && shownIds[0] && ordinal == null ? [shownIds[0]] : []

  const selectedIds = await validateCatalogIds(db, input.accountId, [
    ...ordinalId,
    ...(input.selectedIds ?? []),
    ...selectLast,
    ...(input.seedId ? [input.seedId] : []),
    ...prev.selectedIds,
  ])
  const rejectedIds = await validateCatalogIds(db, input.accountId, [
    ...(input.rejectedIds ?? []),
    ...rejectLast,
    ...prev.rejectedIds,
  ])

  const option = requirements.optionValue
    ? {
        name: requirements.optionName,
        value: requirements.optionValue,
      }
    : prev.option

  const next: ShoppingContext = {
    occasion,
    recipient,
    minPrice: requirements.minPrice ?? prev.minPrice,
    maxPrice: requirements.maxPrice ?? prev.maxPrice,
    colors,
    dislikes: uniq([...explicitDislikes, ...prev.dislikes]),
    option,
    categoryHint,
    selectedIds: selectedIds.filter((id) => !rejectedIds.includes(id)),
    rejectedIds,
    shownIds: shownIds.slice(0, SHOWN_CAP),
    stage: deriveSalesStage({
      seedId: input.seedId ?? selectedIds[0] ?? null,
      selectedIds,
      shownIds,
      hasCart: input.hasCart,
      hasPendingCheckout: input.hasPendingCheckout,
      hasPaidOrder: input.hasPaidOrder,
      complementaryAsk: isComplementaryAsk(input.mode),
    }),
  }
  return next
}

export async function mergeAndPersistShoppingContext(
  db: SupabaseClient,
  input: ShoppingMergeInput,
): Promise<ShoppingContext> {
  const previous =
    input.previous ??
    (await loadShoppingContext(db, input.accountId, input.contactId))
  const merged = await mergeShoppingContext(db, { ...input, previous })
  if (!input.contactId) return merged
  try {
    await persistShoppingContext(
      db,
      input.accountId,
      input.contactId,
      merged,
      input.conversationId,
    )
  } catch (err) {
    console.warn('[catalog-intel] shopping context persist failed', err)
  }
  return merged
}

export async function validateCatalogIds(
  db: SupabaseClient,
  accountId: string,
  ids: string[],
): Promise<string[]> {
  const unique = uniq(ids.map((id) => id.trim()).filter(Boolean))
  if (unique.length === 0) return []
  let found: Awaited<ReturnType<typeof getCatalogProductsByIds>> = []
  try {
    found = await getCatalogProductsByIds(db, accountId, unique)
  } catch {
    found = []
  }
  const resolved = new Map<string, string>()
  for (const product of found) resolved.set(product.id, product.id)
  for (const id of unique) {
    if (resolved.has(id)) continue
    try {
      const product = await lookupCatalogProduct(db, accountId, id)
      if (product) resolved.set(id, product.id)
    } catch {
      // Invalid or mock ids stay unresolved.
    }
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of unique) {
    const mapped = resolved.get(id)
    if (!mapped || seen.has(mapped)) continue
    seen.add(mapped)
    out.push(mapped)
  }
  return out
}

function colorFromRequirements(req: ShoppingRequirements): string | undefined {
  const value = req.optionValue?.trim().toLowerCase()
  if (!value) return undefined
  const name = req.optionName?.trim().toLowerCase()
  if (name && name !== 'color' && name !== 'colour') return undefined
  return value
}

function isSalesStage(value: unknown): value is SalesStage {
  return (
    value === 'discovery' ||
    value === 'consideration' ||
    value === 'product_selected' ||
    value === 'cart' ||
    value === 'checkout' ||
    value === 'purchased' ||
    value === 'post_purchase'
  )
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

function num(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
}

function stringList(raw: unknown, max = LIST_CAP): string[] {
  if (!Array.isArray(raw)) return []
  return uniq(
    raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  ).slice(0, max)
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.trim()
    if (!key) continue
    const norm = key.toLowerCase()
    if (seen.has(norm) || seen.has(key)) continue
    seen.add(norm)
    seen.add(key)
    out.push(key)
    if (out.length >= LIST_CAP) break
  }
  return out
}
