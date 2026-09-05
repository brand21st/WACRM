import { continueKnowledgeScrapeJob } from '@/lib/ai/scrape-job'
import type { KnowledgeScrapeJob } from '@/lib/queue/jobs'

export async function processKnowledgeScrape(data: KnowledgeScrapeJob): Promise<void> {
  await continueKnowledgeScrapeJob(data.jobId)
}
