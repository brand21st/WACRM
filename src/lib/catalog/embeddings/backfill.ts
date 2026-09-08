import type { SupabaseClient } from '@supabase/supabase-js'
import { scheduleCatalogEmbed } from './jobs'

const PAGE_SIZE = 50

export async function enqueueCatalogEmbedBackfill(
  db: SupabaseClient,
  accountId: string,
  shopName?: string | null,
): Promise<{ enqueued: number }> {
  let offset = 0
  let enqueued = 0
  for (;;) {
    const { data, error } = await db
      .from('catalog_products')
      .select('id')
      .eq('account_id', accountId)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data ?? []
    if (rows.length === 0) break
    for (const row of rows) {
      await scheduleCatalogEmbed(db, accountId, String(row.id), shopName)
      enqueued += 1
    }
    if (rows.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return { enqueued }
}
