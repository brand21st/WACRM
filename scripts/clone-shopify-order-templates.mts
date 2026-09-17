/**
 * Copy Shopify order WhatsApp templates + notification rules between accounts,
 * then submit the copied templates to Meta on the destination WABA.
 *
 * Usage:
 *   npx tsx scripts/clone-shopify-order-templates.mts \
 *     --from samanga@samanga.com \
 *     --to storizoonline@gmail.com
 *
 * Flags:
 *   --dry-run       Print what would be copied/submitted; no writes
 *   --skip-submit   Copy templates + rules only; do not call Meta
 *   --overwrite     Replace destination shopify_* templates with the same name/language (default)
 *
 * Runbook:
 *   1. Dry-run first: add --dry-run and confirm template/rule counts
 *   2. Run without --dry-run (requires destination WhatsApp connected)
 *   3. In destination Settings → Shopify → Order templates, confirm rules
 *   4. In Settings → Templates, confirm shopify_* rows are PENDING/APPROVED
 *   5. On submit errors, check message_templates.submission_error and retry via Quick edit
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

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag)
  if (idx < 0 || idx + 1 >= process.argv.length) return null
  return process.argv[idx + 1]
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

const fromEmail = argValue('--from')
const toEmail = argValue('--to')
const dryRun = hasFlag('--dry-run')
const skipSubmit = hasFlag('--skip-submit')
const overwrite = !hasFlag('--skip-existing') || hasFlag('--overwrite')

if (!fromEmail || !toEmail) {
  console.error(
    'Usage: npx tsx scripts/clone-shopify-order-templates.mts --from owner@source.com --to owner@dest.com [--dry-run] [--skip-submit]',
  )
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!skipSubmit && !dryRun && !process.env.ENCRYPTION_KEY) {
  console.error('Missing ENCRYPTION_KEY in .env.local (required to submit to Meta)')
  process.exit(1)
}

const {
  resolveAccountByOwnerEmail,
  listShopifyOrderTemplates,
  listNotificationRules,
  loadWhatsAppConfig,
  toTemplatePayload,
  cloneTemplatesToAccount,
  cloneNotificationRulesToAccount,
} = await import('../src/lib/shopify/clone-order-templates')
const { submitTemplateForAccount } = await import(
  '../src/lib/whatsapp/submit-template-for-account'
)

const supabase = createClient(url, serviceKey)

const source = await resolveAccountByOwnerEmail(supabase, fromEmail)
const dest = await resolveAccountByOwnerEmail(supabase, toEmail)

if (source.accountId === dest.accountId) {
  console.error('Source and destination resolve to the same account.')
  process.exit(1)
}

console.log(
  `Source: ${source.email} (${source.name}) ${source.accountId}`,
)
console.log(
  `Destination: ${dest.email} (${dest.name}) ${dest.accountId}`,
)

const templates = await listShopifyOrderTemplates(supabase, source.accountId)
const rules = await listNotificationRules(supabase, source.accountId)

if (templates.length === 0 && rules.length === 0) {
  console.error('Source has no shopify_* templates or notification rules to copy.')
  process.exit(1)
}

console.log(`Found ${templates.length} shopify_* template(s), ${rules.length} rule(s).`)
for (const row of templates) {
  console.log(`  template ${row.name} ${row.language} status=${row.status ?? 'n/a'}`)
}
for (const row of rules) {
  console.log(
    `  rule ${row.trigger_key} enabled=${row.is_enabled} template=${row.template_name ?? '-'}`,
  )
}

if (!skipSubmit) {
  const wa = await loadWhatsAppConfig(supabase, dest.accountId)
  console.log(`Destination WABA ${wa.waba_id} status=${wa.status ?? 'unknown'}`)
}

if (dryRun) {
  console.log('Dry run — no writes.')
  process.exit(0)
}

const { cloned, skipped } = await cloneTemplatesToAccount(supabase, {
  sourceTemplates: templates,
  destAccountId: dest.accountId,
  destOwnerUserId: dest.ownerUserId,
  overwrite,
})
console.log(`Cloned ${cloned.length} template(s), skipped ${skipped.length}.`)

const ruleCount = await cloneNotificationRulesToAccount(supabase, {
  sourceRules: rules,
  destAccountId: dest.accountId,
})
console.log(`Upserted ${ruleCount} notification rule(s).`)

if (skipSubmit) {
  console.log('Skipped Meta submit (--skip-submit).')
  process.exit(0)
}

let submitted = 0
let failed = 0
for (const row of cloned) {
  const payload = toTemplatePayload(row)
  const result = await submitTemplateForAccount(supabase, {
    accountId: dest.accountId,
    userId: dest.ownerUserId,
    payload,
  })
  if (result.ok) {
    submitted += 1
    const status =
      typeof result.template.status === 'string' ? result.template.status : 'ok'
    console.log(`  submitted ${row.name} ${row.language} → ${status}`)
  } else {
    failed += 1
    console.error(`  submit failed ${row.name} ${row.language}: ${result.error}`)
  }
}

console.log(
  `Done. templates_cloned=${cloned.length} rules=${ruleCount} submitted=${submitted} failed=${failed}`,
)
if (failed > 0) process.exit(1)
