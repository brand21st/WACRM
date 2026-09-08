import type { SupabaseClient } from '@supabase/supabase-js'
import {
  commerceMetaCatalogIds,
  loadCommerceSettings,
} from '@/lib/shopify/commerce-config'
import {
  listWabaProductCatalogs,
  loadWhatsAppAccessToken,
  type WabaCatalogLookup,
} from '@/lib/shopify/meta-catalog-sync'

export interface MetaCatalogListItem {
  id: string
  name: string
}

export interface MetaCatalogPickerPayload {
  catalogs: MetaCatalogListItem[]
  selectedIds: string[]
  primaryId: string | null
  reason: string | null
}

export function buildMetaCatalogPickerPayload(input: {
  graph: WabaCatalogLookup | null
  selectedIds: string[]
  primaryId: string | null
}): MetaCatalogPickerPayload {
  const selectedIds = uniqueIds(input.selectedIds)
  const primaryId =
    textOrNull(input.primaryId) ?? selectedIds[0] ?? null

  if (!input.graph) {
    return {
      catalogs: [],
      selectedIds,
      primaryId,
      reason: 'connect_whatsapp',
    }
  }

  if (input.graph.status === 'unavailable') {
    return {
      catalogs: [],
      selectedIds,
      primaryId,
      reason: input.graph.reason || 'unavailable',
    }
  }

  if (input.graph.catalogs.length === 0) {
    return {
      catalogs: [],
      selectedIds,
      primaryId,
      reason: 'none_connected',
    }
  }

  return {
    catalogs: mergeListedCatalogs(input.graph.catalogs, selectedIds),
    selectedIds,
    primaryId,
    reason: null,
  }
}

export async function loadMetaCatalogPicker(
  db: SupabaseClient,
  accountId: string,
): Promise<MetaCatalogPickerPayload> {
  const settings = await loadCommerceSettings(db, accountId)
  const selectedIds = commerceMetaCatalogIds(settings)
  const primaryId = settings.metaCatalogId?.trim() || selectedIds[0] || null

  const wa = await loadWhatsAppAccessToken(db, accountId)
  if (!wa) {
    return buildMetaCatalogPickerPayload({
      graph: null,
      selectedIds,
      primaryId,
    })
  }

  const graph = await listWabaProductCatalogs(wa.wabaId, wa.token)
  return buildMetaCatalogPickerPayload({
    graph,
    selectedIds,
    primaryId,
  })
}

function mergeListedCatalogs(
  listed: { id: string; name?: string }[],
  selectedIds: string[],
): MetaCatalogListItem[] {
  const catalogs: MetaCatalogListItem[] = []
  const seen = new Set<string>()
  for (const row of listed) {
    const id = row.id.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    catalogs.push({ id, name: row.name?.trim() || id })
  }
  for (const id of selectedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    catalogs.push({ id, name: id })
  }
  return catalogs
}

function uniqueIds(raw: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const id = item.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function textOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t || null
}
