import { supabaseAdmin } from '@/lib/ai/admin-client'
import { generateCatalogProductEmbedding } from '@/lib/catalog/embeddings/generate'
import type { CatalogEmbedJob } from '@/lib/queue/jobs'

export async function processCatalogEmbed(data: CatalogEmbedJob): Promise<void> {
  await generateCatalogProductEmbedding(
    supabaseAdmin(),
    data.accountId,
    data.productId,
  )
}
