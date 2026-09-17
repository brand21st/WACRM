'use client';

import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { KnowledgeStatsPayload, BreakdownKey } from '@/lib/ai/knowledge-stats';
import { BarChart } from '@/components/tremor/bar-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SettingsChip } from '@/components/settings/settings-chip';
import { cn } from '@/lib/utils';

function formatChars(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function ScoreRing({ score }: { score: number }) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative size-20 shrink-0">
      <svg className="size-20 -rotate-90" viewBox="0 0 80 80" aria-hidden>
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-muted/60"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums text-foreground">{score}</span>
      </div>
    </div>
  );
}

const BREAKDOWN_LABEL_KEYS: Record<BreakdownKey, string> = {
  shopify_products: 'coverageBreakdownProducts',
  shopify_pages: 'coverageBreakdownPages',
  shopify_policies: 'coverageBreakdownPolicies',
  manual: 'coverageBreakdownManual',
  website: 'coverageBreakdownWebsite',
};

export function KnowledgeCoverageCard({
  stats,
  loading,
}: {
  stats: KnowledgeStatsPayload | null;
  loading: boolean;
}) {
  const t = useTranslations('Settings.knowledgeBase');

  const chartData = useMemo(() => {
    if (!stats) return [];
    return stats.breakdown
      .map((row) => ({
        source: t(BREAKDOWN_LABEL_KEYS[row.key]),
        characters: row.characters > 0 ? row.characters : row.chunks,
        items: row.indexed_items,
      }))
      .filter((row) => row.characters > 0);
  }, [stats, t]);

  const empty =
    !loading &&
    stats &&
    stats.score === 0 &&
    stats.total_chunks === 0 &&
    stats.total_indexed_chars === 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('coverageTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('coverageLoading')}
          </div>
        ) : empty ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('coverageEmpty')}
          </p>
        ) : (
          <Tabs defaultValue="score">
            <TabsList className="mb-4 h-8">
              <TabsTrigger value="score" className="text-xs">
                {t('coverageTabScore')}
              </TabsTrigger>
              <TabsTrigger value="breakdown" className="text-xs">
                {t('coverageTabBreakdown')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="score" className="mt-0">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <ScoreRing score={stats?.score ?? 0} />
                <div className="min-w-0 flex-1 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {t('coverageScoreLabel')}
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        {t('coverageChunks')}
                      </p>
                      <p className="font-semibold tabular-nums text-foreground">
                        {stats?.total_chunks ?? 0}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        {t('coverageChars')}
                      </p>
                      <p className="font-semibold tabular-nums text-foreground">
                        {formatChars(stats?.total_indexed_chars ?? 0)}
                      </p>
                    </div>
                    <div
                      className={cn(
                        'rounded-lg border border-border bg-muted/30 px-3 py-2',
                        'col-span-2 sm:col-span-1',
                      )}
                    >
                      <p className="text-xs text-muted-foreground">
                        {t('coverageEmbeddings')}
                      </p>
                      {stats?.has_embeddings_key ? (
                        <p className="font-semibold tabular-nums text-foreground">
                          {stats.embedding_coverage_pct}%
                        </p>
                      ) : (
                        <SettingsChip variant="muted" className="mt-1">
                          {t('coverageKeywordSearch')}
                        </SettingsChip>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="breakdown" className="mt-0">
              {chartData.length > 0 ? (
                <BarChart
                  data={chartData}
                  index="source"
                  categories={['characters']}
                  className="h-36"
                  valueFormatter={(value) => formatChars(Number(value))}
                />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t('coverageEmpty')}
                </p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
