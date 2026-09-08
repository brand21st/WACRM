import type { SupabaseClient } from '@supabase/supabase-js'

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean
type OrderSpec = { column: string; ascending: boolean; nullsFirst: boolean }

function matchIlike(value: unknown, pattern: string): boolean {
  const raw = String(value ?? '').toLowerCase()
  const escaped = pattern
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.')
  return new RegExp(`^${escaped}$`).test(raw)
}

function compareOrdered(rowValue: unknown, value: unknown, op: 'gte' | 'lte'): boolean {
  if (rowValue == null || value == null) return false
  const left = Number(rowValue)
  const right = Number(value)
  if (Number.isFinite(left) && Number.isFinite(right)) {
    return op === 'gte' ? left >= right : left <= right
  }
  const leftText = String(rowValue)
  const rightText = String(value)
  return op === 'gte' ? leftText >= rightText : leftText <= rightText
}

function parseOrClause(clause: string): Filter {
  const parts = clause.split(/,(?=[a-z_]+\.)/i)
  const checks = parts.map((part) => {
    const ilike = part.match(/^([a-z_]+)\.ilike\.(.+)$/i)
    if (ilike) return (row: Row) => matchIlike(row[ilike[1]], ilike[2])
    const eq = part.match(/^([a-z_]+)\.eq\.(.+)$/i)
    if (eq) return (row: Row) => String(row[eq[1]] ?? '') === eq[2]
    const gte = part.match(/^([a-z_]+)\.gte\.(.+)$/i)
    if (gte) return (row: Row) => Number(row[gte[1]]) >= Number(gte[2])
    const lte = part.match(/^([a-z_]+)\.lte\.(.+)$/i)
    if (lte) return (row: Row) => Number(row[lte[1]]) <= Number(lte[2])
    return () => false
  })
  return (row) => checks.some((fn) => fn(row))
}

export function createCatalogMemoryDb(
  seed: Record<string, Row[]> = {},
): SupabaseClient {
  const tables: Record<string, Row[]> = {
    catalog_products: [],
    catalog_variants: [],
    catalog_media: [],
    catalog_external_ids: [],
    catalog_collections: [],
    catalog_product_collections: [],
    catalog_attributes: [],
    catalog_attribute_values: [],
    catalog_product_relations: [],
    catalog_product_embeddings: [],
    catalog_recommendation_events: [],
    catalog_product_events: [],
    contact_ai_memory: [],
    whatsapp_commerce_orders: [],
    whatsapp_config: [],
    shopify_configs: [],
    ai_configs: [],
    shopify_catalog_products: [],
    ...Object.fromEntries(
      Object.entries(seed).map(([key, rows]) => [key, rows.map((row) => ({ ...row }))]),
    ),
  }

  const from = (table: string) => {
    const rows = () => tables[table] ?? []
    const filters: Filter[] = []
    const orders: OrderSpec[] = []
    let limitN = Number.POSITIVE_INFINITY

    const apply = () => {
      const filtered = rows().filter((row) => filters.every((fn) => fn(row)))
      const sorted = [...filtered].sort((a, b) => {
        for (const spec of orders) {
          const av = a[spec.column]
          const bv = b[spec.column]
          if (av == null && bv == null) continue
          if (av == null) return spec.nullsFirst ? -1 : 1
          if (bv == null) return spec.nullsFirst ? 1 : -1
          if (av < bv) return spec.ascending ? -1 : 1
          if (av > bv) return spec.ascending ? 1 : -1
        }
        return 0
      })
      return sorted.slice(0, Number.isFinite(limitN) ? limitN : sorted.length)
    }

    let countOnly = false
    let rangeFrom = 0
    let rangeTo = Number.POSITIVE_INFINITY
    let writeMode: 'select' | 'delete' | 'update' = 'select'
    let pendingUpdate: Row | null = null
    const result = () => {
      const rows = apply()
      const sliced = rows.slice(
        rangeFrom,
        Number.isFinite(rangeTo) ? rangeTo + 1 : rows.length,
      )
      return {
        data: countOnly ? null : sliced,
        count: sliced.length,
        error: null,
      }
    }
    const builder: Record<string, unknown> = {
      select: (_columns?: string, opts?: { count?: string; head?: boolean }) => {
        countOnly = opts?.head === true
        return builder
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return builder
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      ilike: (column: string, pattern: string) => {
        filters.push((row) => matchIlike(row[column], pattern))
        return builder
      },
      gte: (column: string, value: unknown) => {
        filters.push((row) => compareOrdered(row[column], value, 'gte'))
        return builder
      },
      lte: (column: string, value: unknown) => {
        filters.push((row) => compareOrdered(row[column], value, 'lte'))
        return builder
      },
      or: (clause: string) => {
        filters.push(parseOrClause(clause))
        return builder
      },
      textSearch: (_column: string, query: string) => {
        const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
        filters.push((row) => {
          const hay = `${row.title ?? ''} ${row.description ?? ''}`.toLowerCase()
          return tokens.every((token) => hay.includes(token))
        })
        return builder
      },
      order: (column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) => {
        orders.push({
          column,
          ascending: opts?.ascending !== false,
          nullsFirst: opts?.nullsFirst === true,
        })
        return builder
      },
      limit: (n: number) => {
        limitN = n
        return builder
      },
      range: (from: number, to: number) => {
        rangeFrom = from
        rangeTo = to
        return builder
      },
      insert: (payload: Row | Row[]) => {
        if (!tables[table]) tables[table] = []
        const items = Array.isArray(payload) ? payload : [payload]
        const uniqueKeys: Record<string, string[]> = {
          catalog_collections: ['account_id', 'handle'],
          catalog_products: ['account_id', 'handle'],
        }
        const keys = uniqueKeys[table] ?? []
        const clash = items.some((item) =>
          tables[table].some((row) => keys.every((key) => row[key] === item[key])),
        )
        if (clash && keys.length > 0) {
          const err = { data: null, error: { code: '23505', message: 'duplicate key' } }
          return {
            select: () => ({
              maybeSingle: async () => err,
            }),
            then: (resolve: (value: typeof err) => void) => resolve(err),
          }
        }
        const written = items.map((item, index) => ({
          id: item.id ?? `${table}-${tables[table].length + index}`,
          created_at: item.created_at ?? new Date().toISOString(),
          ...item,
        }))
        tables[table].push(...written)
        const ok = { data: written, error: null }
        return {
          select: () => ({
            maybeSingle: async () => ({ data: written[0] ?? null, error: null }),
          }),
          then: (resolve: (value: typeof ok) => void) => resolve(ok),
        }
      },
      delete: () => {
        writeMode = 'delete'
        return builder
      },
      update: (payload: Row) => {
        writeMode = 'update'
        pendingUpdate = payload
        return builder
      },
      upsert: async (payload: Row | Row[], opts?: { onConflict?: string }) => {
        if (!tables[table]) tables[table] = []
        const items = Array.isArray(payload) ? payload : [payload]
        const key = opts?.onConflict ?? 'id'
        for (const item of items) {
          const idx = tables[table].findIndex((row) => row[key] === item[key])
          if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...item }
          else tables[table].push({ ...item })
        }
        return { data: items, error: null }
      },
      maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[] | null; error: null }) => void) => {
        if (writeMode === 'delete') {
          if (!tables[table]) tables[table] = []
          const matched = new Set(apply())
          tables[table] = rows().filter((row) => !matched.has(row))
          writeMode = 'select'
          resolve({ data: null, error: null })
          return
        }
        if (writeMode === 'update' && pendingUpdate) {
          if (!tables[table]) tables[table] = []
          const matched = apply()
          for (const row of matched) Object.assign(row, pendingUpdate)
          writeMode = 'select'
          pendingUpdate = null
          resolve({ data: matched, error: null })
          return
        }
        resolve(result())
      },
    }
    return builder
  }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    if (fn !== 'match_catalog_products_semantic') {
      return { data: [], error: null }
    }
    const accountId = String(args.p_account_id ?? '')
    const model = String(args.p_model ?? '')
    const matchCount = Number(args.p_match_count ?? 20)
    const active = new Set(
      (tables.catalog_products ?? [])
        .filter((row) => row.account_id === accountId && row.status === 'active')
        .map((row) => String(row.id)),
    )
    const hits = (tables.catalog_product_embeddings ?? [])
      .filter(
        (row) =>
          row.account_id === accountId &&
          row.model === model &&
          (row.status === 'ready' || row.status === 'stale') &&
          (row.dimensions == null || row.dimensions === 1536) &&
          row.embedding != null &&
          active.has(String(row.product_id)),
      )
      .slice(0, Number.isFinite(matchCount) ? matchCount : 20)
      .map((row) => ({ product_id: row.product_id }))
    return { data: hits, error: null }
  }

  return { from, rpc } as unknown as SupabaseClient
}
