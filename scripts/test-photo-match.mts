/**
 * Live check: match a vision-style description against the connected catalog.
 * Usage: npx tsx scripts/test-photo-match.mts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  const text = readFileSync('.env.local', 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key || !process.env.ENCRYPTION_KEY) {
  console.error('Missing Supabase URL, service role key, or ENCRYPTION_KEY')
  process.exit(1)
}

const db = createClient(url, key)
const { loadShopifyConfig } = await import('../src/lib/shopify/config')
const { matchProductsFromPhoto, photoMatchQueries } =
  await import('../src/lib/shopify/match-photo')
const { PRODUCT_PHOTO_PLACEHOLDER } =
  await import('../src/lib/ai/describe-inbound-image')

const { data: rows, error } = await db
  .from('shopify_configs')
  .select('account_id, shop_domain, catalog_product_count, last_catalog_sync_at')
  .limit(3)

if (error) {
  console.error('shopify_configs query failed:', error.message)
  process.exit(1)
}
if (!rows?.length) {
  console.log('No Shopify configs found.')
  process.exit(0)
}

const description = process.argv[2]?.trim() || 'red leather tote bag with gold zipper'
console.log('description:', description)
console.log('queries:', photoMatchQueries(description).join(' | '))

for (const row of rows) {
  console.log('---')
  console.log('account', row.account_id)
  console.log('shop', row.shop_domain)
  console.log('catalog_count', row.catalog_product_count)
  console.log('last_sync', row.last_catalog_sync_at)

  const config = await loadShopifyConfig(db, row.account_id, {
    requireActive: false,
  }).catch((err: unknown) => {
    console.error('loadShopifyConfig failed:', err instanceof Error ? err.message : err)
    return null
  })
  if (!config) {
    console.log('skip: config not loadable')
    continue
  }

  const placeholderHits = await matchProductsFromPhoto(
    db,
    config,
    PRODUCT_PHOTO_PLACEHOLDER,
  )
  console.log('placeholder_hits', placeholderHits.length)

  const hits = await matchProductsFromPhoto(db, config, description)
  console.log('match_count', hits.length)
  for (const hit of hits) {
    console.log(
      '-',
      hit.title,
      '|',
      hit.handle,
      '|',
      hit.priceMin,
      hit.currency,
      '|',
      hit.imageUrl ? 'has_image' : 'no_image',
      '|',
      hit.productUrl,
    )
  }
}
