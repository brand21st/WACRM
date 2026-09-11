import { beforeEach, describe, expect, it, vi } from 'vitest';

const { admin, reconcile } = vi.hoisted(() => ({
  admin: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: admin,
}));
vi.mock('@/lib/catalog/intelligence/recommendation-aggregation', () => ({
  reconcileRecommendationIntelligence: reconcile,
}));

import {
  aiRecommendationIntelligenceJob,
  processAiRecommendationIntelligence,
} from './ai-recommendation-intelligence';

describe('ai recommendation intelligence processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    admin.mockReturnValue({ client: true });
    reconcile.mockResolvedValue(undefined);
  });

  it('builds a stable account job and forwards rebuild intent', async () => {
    const job = aiRecommendationIntelligenceJob(' acct-a ', { rebuild: true });
    expect(job).toEqual(
      expect.objectContaining({
        accountId: 'acct-a',
        idempotencyKey: 'acct-a:recommendation-intelligence',
        runId: expect.any(String),
        rebuild: true,
      })
    );
    await processAiRecommendationIntelligence(job);
    expect(reconcile).toHaveBeenCalledWith({ client: true }, 'acct-a', {
      force: true,
    });
  });
});
