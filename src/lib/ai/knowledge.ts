import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiConfig } from './types'
import { AiError } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

interface MatchRow {
  id: string
  content: string
}

const LEXICAL_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'is',
  'are',
  'am',
  'was',
  'were',
  'be',
  'do',
  'does',
  'did',
  'what',
  'which',
  'who',
  'whom',
  'your',
  'you',
  'me',
  'my',
  'our',
  'we',
  'please',
  'tell',
  'about',
  'can',
  'could',
  'would',
  'should',
  'how',
  'when',
  'where',
  'why',
  'this',
  'that',
  'with',
  'from',
  'give',
  'have',
  'got',
  'any',
  'also',
  'just',
  'need',
  'want',
  'looking',
])

const COMPANY_INTENT =
  /\b(about(\s+us)?|company|who are you|who is this|what (do you|does .+ )?(do|sell|offer)|hours|contact|address|location|business|store|shipping|returns?|refunds?|privacy|terms|faq|cod|cash on delivery|customi[sz]e|open(ing)?(\s+hours)?|timing)\b/i

const CONTACT_INTENT =
  /\b(contact(\s+(number|no|details?|info|information))?|phone(\s+number)?|mobile(\s+number)?|whatsapp(\s+number)?|customer\s+care|helpline|call\s+us|hotline|landline)\b/i

const FAQ_SYNONYMS: Array<{ intent: RegExp; terms: string[] }> = [
  {
    intent: CONTACT_INTENT,
    terms: ['contact', 'phone', 'care', 'whatsapp', 'helpline', 'mobile'],
  },
  {
    intent: /\b(hours?|open|opening|timing|timings|closed|sunday)\b/i,
    terms: ['hours', 'open', 'timing', 'closed'],
  },
  {
    intent: /\b(cod|cash on delivery|cash-on-delivery)\b/i,
    terms: ['cod', 'cash', 'delivery'],
  },
  {
    intent: /\b(customi[sz]e|customi[sz]ation|alter)\b/i,
    terms: ['customization', 'customise', 'customize'],
  },
  {
    intent: /\b(deliver(?:y|ies)?|shipping|dispatch|how long|when will)\b/i,
    terms: ['delivery', 'shipping', 'dispatch'],
  },
  {
    intent: /\b(returns?|refunds?|exchange)\b/i,
    terms: ['return', 'refund', 'exchange'],
  },
]

const DOC_MATCH_MIN_SCORE = 12
const DOC_SCAN_LIMIT = 80
const CONTACT_EXCERPT_MAX = 800

/**
 * Prefix the document title onto the body so FTS/semantic can match
 * company-style questions against titles like "About Acme".
 */
export function titledIngestContent(content: string, title?: string | null): string {
  const body = content.replace(/\r\n/g, '\n').trim()
  const head = title?.trim() ?? ''
  if (!head) return body
  if (!body) return head
  if (body.toLowerCase().startsWith(head.toLowerCase())) return body
  return `${head}\n\n${body}`
}

function lexicalTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !LEXICAL_STOPWORDS.has(t))
}

function hasWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack)
}

/** Query tokens plus FAQ synonyms (contact, hours, COD, delivery…). */
export function knowledgeSearchNeedles(query: string): string[] {
  const needles: string[] = []
  const add = (term: string) => {
    const t = term.toLowerCase().trim()
    if (t.length > 1 && !needles.includes(t)) needles.push(t)
  }
  for (const token of lexicalTokens(query)) add(token)
  for (const { intent, terms } of FAQ_SYNONYMS) {
    if (intent.test(query)) {
      for (const term of terms) add(term)
    }
  }
  return needles
}

/** Drop conversational filler so FTS does not AND-match "tell me about your". */
export function lexicalSearchQuery(raw: string): string {
  return lexicalTokens(raw).join(' ').trim()
}

/**
 * websearch_to_tsquery string: unquoted OR so “give contact number”
 * still matches a chunk that only contains “contact”.
 */
export function ftsWebsearchQuery(raw: string): string {
  const needles = knowledgeSearchNeedles(raw)
  if (needles.length === 0) return raw.trim()
  if (needles.length === 1) return needles[0]
  return needles
    .slice(0, 6)
    .map((term) => (/\s/.test(term) ? `"${term}"` : term))
    .join(' OR ')
}

export function isContactIntent(query: string): boolean {
  return CONTACT_INTENT.test(query.trim())
}

export function isFaqIntent(query: string): boolean {
  const q = query.trim()
  return FAQ_SYNONYMS.some(({ intent }) => intent.test(q)) || isCompanyIntent(q)
}

export function isCompanyIntent(query: string): boolean {
  return COMPANY_INTENT.test(query.trim()) || isContactIntent(query)
}

export function excerptHasPhoneNumber(text: string): boolean {
  return /(?:\+?\d[\d\s().-]{7,}\d)/.test(text)
}

/** Manual FAQ/contact docs first so empty Shopify pages cannot hide saved facts. */
export function mergeKnowledgeSources(
  query: string,
  storeContent: string[],
  manualKnowledge: string[],
  limit = 8,
): string[] {
  const manual = manualKnowledge.filter((excerpt) => excerpt.trim().length > 0)
  const store = storeContent.filter((excerpt) => excerpt.trim().length > 0)
  if (isFaqIntent(query)) {
    const storeWithPhone = store.filter(excerptHasPhoneNumber)
    const storeRest = store.filter(
      (excerpt) => !excerptHasPhoneNumber(excerpt) && storeExcerptHasBody(excerpt),
    )
    return [...manual, ...storeWithPhone, ...storeRest].slice(0, limit)
  }
  return [...store, ...manual].slice(0, limit)
}

function storeExcerptHasBody(excerpt: string): boolean {
  const body = excerpt.split('\n').slice(1).join('\n').trim()
  return body.length >= 40
}

function capExcerpt(raw: string, max = CONTACT_EXCERPT_MAX): string {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1).trim()}…`
}

function scoreKnowledgeDocument(
  title: string,
  content: string,
  sourceType: string | null | undefined,
  needles: string[],
): number {
  if (needles.length === 0) return 0
  let score = 0
  for (const needle of needles) {
    if (hasWord(title, needle) || title.toLowerCase().includes(needle)) score += 12
    if (hasWord(content, needle) || content.toLowerCase().includes(needle)) score += 3
  }
  if ((sourceType ?? 'manual') === 'manual') score += 10
  return score
}

type ScoredDoc = { id: string; excerpt: string; score: number }

async function searchScoredKnowledgeDocuments(
  db: SupabaseClient,
  accountId: string,
  query: string,
  limit: number,
): Promise<ScoredDoc[]> {
  const needles = knowledgeSearchNeedles(query)
  if (needles.length === 0) return []
  try {
    const { data, error } = await db
      .from('ai_knowledge_documents')
      .select('id, title, content, source_type')
      .eq('account_id', accountId)
      .limit(DOC_SCAN_LIMIT)
    if (error || !Array.isArray(data)) return []

    const ranked: ScoredDoc[] = []
    for (const row of data as Array<{
      id?: string
      title?: string | null
      content?: string | null
      source_type?: string | null
    }>) {
      const id = String(row.id ?? '').trim()
      const title = String(row.title ?? '').trim()
      const content = String(row.content ?? '').trim()
      if (!id || !content) continue
      if (/^\[shopify product\]/i.test(title)) continue
      const score = scoreKnowledgeDocument(title, content, row.source_type, needles)
      if (score < DOC_MATCH_MIN_SCORE) continue
      ranked.push({
        id,
        score,
        excerpt: capExcerpt(titledIngestContent(content, title)),
      })
    }
    ranked.sort((a, b) => b.score - a.score)
    return ranked.slice(0, limit)
  } catch (err) {
    console.error('[ai knowledge] document scoring failed:', err)
    return []
  }
}

/**
 * (Re)build the chunks for one document. Deletes the document's
 * existing chunks, re-chunks the content, and — when the account has an
 * embeddings key — embeds each chunk. Runs under whatever client the
 * caller passes (service-role for ingest routes).
 *
 * Throws on embedding failure so the ingest route can report it; the
 * chunks are only written once embedding (if attempted) succeeds, so a
 * failed embed never leaves half-indexed rows.
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
  title?: string | null,
): Promise<void> {
  const chunks = chunkText(titledIngestContent(content, title))

  // Replace, don't append — re-ingest must be idempotent.
  const { error: delErr } = await db
    .from('ai_knowledge_chunks')
    .delete()
    .eq('document_id', documentId)
  if (delErr) throw delErr

  if (chunks.length === 0) return

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically. We record the error and rethrow it
  // AFTER inserting (embedding-less) rows, so the route can warn
  // "semantic indexing failed" — which is now truthful, because lexical
  // search really does still work.
  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks)
    } catch (err) {
      embedError = err
    }
  }

  const rows = chunks.map((chunk, i) => ({
    document_id: documentId,
    account_id: accountId,
    chunk_index: i,
    content: chunk,
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
  }))

  const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
  if (insErr) throw insErr

  if (embedError) {
    const message =
      embedError instanceof Error ? embedError.message : 'indexing failed'
    throw new AiError(message, { code: 'embed_failed', status: 502 })
  }
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`.
 *
 * Semantic-primary when an embeddings key is configured (embed the
 * query → cosine-nearest chunks), then topped up with lexical full-text
 * matches to fill `k`. Lexical-only when there's no key. Best-effort:
 * any failure (no KB, embedding error, RPC error) degrades to fewer or
 * zero results and never throws into the draft / auto-reply path.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 5,
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []

  // Skip everything when the account has no knowledge base — otherwise
  // every draft / auto-reply would pay for a query embedding + two RPCs
  // just to get []. One cheap indexed COUNT (head, no rows) instead of a
  // paid embeddings call on the hot path.
  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (error || !count) return []
  } catch {
    return []
  }

  const picked = new Map<string, string>() // id → content, preserves order
  const ftsQuery = ftsWebsearchQuery(query) || lexicalSearchQuery(query) || query

  const rankedDocs = await searchScoredKnowledgeDocuments(db, accountId, query, k)
  for (const doc of rankedDocs) {
    picked.set(`doc:${doc.id}`, doc.excerpt)
    if (picked.size >= k) break
  }
  if (rankedDocs.length > 0) {
    return Array.from(picked.values()).slice(0, k)
  }

  // Semantic path.
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  // Lexical top-up (also the sole path when there's no embeddings key).
  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: ftsQuery,
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  if (picked.size === 0 || (isCompanyIntent(query) && picked.size < k)) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fallback', {
        p_account_id: accountId,
        p_query: ftsQuery,
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] fallback retrieval failed:', err)
    }
  }

  return Array.from(picked.values()).slice(0, k)
}
