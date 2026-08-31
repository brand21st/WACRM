/**
 * One-off: repack stored shpss_ secrets with Client ID (column or env).
 * Usage: npx tsx scripts/repair-shopify-credentials.mts
 * Optional: SHOPIFY_CLIENT_ID=... in .env.local
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  try {
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
  } catch {
    // .env.local optional when vars are already exported.
  }
}

loadEnvLocal()

const {
  packShopifyCredential,
  unpackShopifyCredential,
  resolveStoredClientId,
} = await import('../src/lib/shopify/credential-storage')
const { isApiSecretKey } = await import('../src/lib/shopify/oauth')
const { encrypt, decrypt } = await import('../src/lib/whatsapp/encryption')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const fallbackClientId = process.env.SHOPIFY_CLIENT_ID?.trim() ?? null

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

if (!process.env.ENCRYPTION_KEY) {
  console.error('Missing ENCRYPTION_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, serviceKey)

const { data: rows, error } = await supabase.from('shopify_configs').select('*')
if (error) {
  console.error('Failed to read shopify_configs:', error.message)
  process.exit(1)
}

if (!rows?.length) {
  console.log('No shopify_configs rows found.')
  process.exit(0)
}

for (const row of rows) {
  const decrypted = decrypt(row.access_token as string)
  const unpacked = unpackShopifyCredential(decrypted)
  const clientId =
    resolveStoredClientId(
      (row as { client_id?: string | null }).client_id,
      unpacked.clientId,
    ) ?? fallbackClientId

  if (isApiSecretKey(unpacked.credential) && !clientId) {
    console.error(
      `Account ${row.account_id}: shpss_ stored without Client ID — set SHOPIFY_CLIENT_ID in .env.local`,
    )
    continue
  }

  const packed = packShopifyCredential(clientId, unpacked.credential)
  const encrypted = encrypt(packed)

  let updateError: { message: string; code?: string } | null = null
  const withClient = { access_token: encrypted, client_id: clientId }
  const withoutClient = { access_token: encrypted }

  ;({ error: updateError } = await supabase
    .from('shopify_configs')
    .update(withClient)
    .eq('id', row.id))

  if (updateError?.code === '42703' || updateError?.code === 'PGRST204') {
    ;({ error: updateError } = await supabase
      .from('shopify_configs')
      .update(withoutClient)
      .eq('id', row.id))
  }

  if (updateError) {
    console.error(`Account ${row.account_id}: update failed:`, updateError.message)
    continue
  }

  console.log(
    `Repacked Shopify credentials for account ${row.account_id} (${row.shop_domain})`,
  )
}

const { loadShopifyConfig } = await import('../src/lib/shopify/config')
const { syncCatalog } = await import('../src/lib/shopify/catalog')

for (const row of rows) {
  const accountId = row.account_id as string
  try {
    const config = await loadShopifyConfig(supabase, accountId, {
      requireActive: false,
    })
    if (!config) continue
    const result = await syncCatalog(supabase, config)
    console.log(
      `Synced ${result.count} products for account ${accountId} (${row.shop_domain})`,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Catalog sync failed for ${accountId}:`, msg)
  }
}
