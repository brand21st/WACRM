import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const accountId = '816f55c7-3d0b-490c-881f-9a13f673ac46'

const { data: ai } = await sb
  .from('ai_configs')
  .select(
    'is_active, auto_reply_enabled, auto_reply_unlimited, auto_reply_max_per_conversation, full_agent_enabled, provider, model',
  )
  .eq('account_id', accountId)
  .maybeSingle()

const { data: wa } = await sb
  .from('whatsapp_config')
  .select('phone_number_id, waba_id')
  .eq('account_id', accountId)
  .maybeSingle()

const { data: convs } = await sb
  .from('conversations')
  .select(
    'id, assigned_agent_id, ai_autoreply_disabled, ai_reply_count, last_message_text, updated_at',
  )
  .eq('account_id', accountId)
  .order('updated_at', { ascending: false })
  .limit(5)

const { data: recentInbound } = await sb
  .from('messages')
  .select('id, conversation_id, direction, content_text, ai_generated, created_at')
  .eq('direction', 'inbound')
  .in(
    'conversation_id',
    (convs ?? []).map((c) => c.id),
  )
  .order('created_at', { ascending: false })
  .limit(10)

const { data: recentOutbound } = await sb
  .from('messages')
  .select('id, conversation_id, direction, content_type, content_text, ai_generated, created_at')
  .eq('direction', 'outbound')
  .in(
    'conversation_id',
    (convs ?? []).map((c) => c.id),
  )
  .order('created_at', { ascending: false })
  .limit(10)

console.log('=== AI config ===')
console.log(ai ?? 'NO ROW — configure Settings → AI Assistant')

console.log('\n=== WhatsApp ===')
console.log(wa ?? 'NO ROW — configure Settings → WhatsApp')

console.log('\n=== Recent conversations ===')
for (const c of convs ?? []) {
  const max = ai?.auto_reply_max_per_conversation ?? 3
  const capped =
    !ai?.auto_reply_unlimited && (c.ai_reply_count ?? 0) >= max
  console.log({
    id: c.id.slice(0, 8),
    ai_disabled: c.ai_autoreply_disabled,
    ai_replies: c.ai_reply_count,
    capped,
    assigned: c.assigned_agent_id ? 'yes' : 'no',
    preview: (c.last_message_text ?? '').slice(0, 50),
  })
}

console.log('\n=== Last inbound messages ===')
for (const m of recentInbound ?? []) {
  console.log({
    conv: m.conversation_id?.slice(0, 8),
    at: m.created_at,
    text: (m.content_text ?? '').slice(0, 60),
  })
}

console.log('\n=== Last outbound (AI?) ===')
for (const m of recentOutbound ?? []) {
  console.log({
    conv: m.conversation_id?.slice(0, 8),
    ai: m.ai_generated,
    type: m.content_type,
    at: m.created_at,
    text: (m.content_text ?? '').slice(0, 60),
  })
}

// Blockers summary
const blockers: string[] = []
if (!ai) blockers.push('No AI config row')
else {
  if (!ai.is_active) blockers.push('AI master switch OFF (is_active)')
  if (!ai.auto_reply_enabled) blockers.push('Auto-reply OFF')
}
if (!wa) blockers.push('WhatsApp not connected')

const activeConv = convs?.[0]
if (activeConv) {
  const max = ai?.auto_reply_max_per_conversation ?? 3
  if (!ai?.auto_reply_unlimited && (activeConv.ai_reply_count ?? 0) >= max) {
    blockers.push(
      `Reply cap hit on latest thread (${activeConv.ai_reply_count}/${max}) — tap Resume AI in inbox`,
    )
  }
  if (activeConv.ai_autoreply_disabled && !ai?.full_agent_enabled) {
    blockers.push('AI paused on latest thread (Take over)')
  }
  if (activeConv.assigned_agent_id) {
    blockers.push('Human assigned on latest thread')
  }
}

// Optional: pass RESET=1 to clear cap on latest thread
if (process.env.RESET === '1' && activeConv) {
  const { error } = await sb
    .from('conversations')
    .update({ ai_reply_count: 0, ai_autoreply_disabled: false })
    .eq('id', activeConv.id)
  console.log('\n=== Reset latest thread ===')
  console.log(error ? error.message : 'ai_reply_count reset to 0')
}
