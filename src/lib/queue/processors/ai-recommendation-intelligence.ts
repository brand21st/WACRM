import { supabaseAdmin } from '@/lib/ai/admin-client';
import { reconcileRecommendationIntelligence } from '@/lib/catalog/intelligence/recommendation-aggregation';
import {
  aiRecommendationIntelligenceJob,
  type AiRecommendationIntelligenceJob,
} from '@/lib/queue/jobs';

export { aiRecommendationIntelligenceJob };

/** Isolated processor; queue wiring is intentionally owned by the parent. */
export async function processAiRecommendationIntelligence(
  job: AiRecommendationIntelligenceJob
): Promise<void> {
  await reconcileRecommendationIntelligence(supabaseAdmin(), job.accountId, {
    force: job.rebuild === true,
  });
}
