'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  fetchLearningSummary,
  fetchOverview,
  type IntelligenceOverview,
  type LearningInsight,
  type MerchantLearningSummary,
} from './api';
import { NO_DATA_COPY, UNAVAILABLE_COPY, formatWhen } from './view-model';

type OverviewDestination = 'events' | 'patterns' | 'shadow' | 'operations';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-foreground mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

const STATUS_COPY: Record<MerchantLearningSummary['status'], string> = {
  not_installed: 'Not installed',
  off: 'Off',
  paused: 'Paused',
  active_deterministic: 'Active · Deterministic',
  active_hybrid: 'Active · Hybrid',
};

const STRENGTH_COPY: Record<LearningInsight['strength'], string> = {
  observed: 'Observed',
  emerging: 'Emerging',
  strong: 'Strong',
};

function evidenceCopy(insight: LearningInsight): string {
  const parts = [
    `${insight.evidence.sampleSize} observations`,
    insight.evidence.windowDays === 0
      ? 'lifetime evidence'
      : `${insight.evidence.windowDays}-day window`,
  ];
  if (insight.evidence.outcomeCount > 0) {
    parts.push(`${insight.evidence.outcomeCount} eligible outcomes`);
    parts.push(`${insight.evidence.unresolvedCount} unresolved`);
  }
  return parts.join(' · ');
}

export function LearningSummaryCard({
  summary,
  onNavigate,
}: {
  summary: MerchantLearningSummary;
  onNavigate?: (destination: OverviewDestination) => void;
}) {
  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>AI Learning Summary</CardTitle>
          <CardDescription>
            What Vachat has observed from this business. Customer replies stay
            unchanged.
          </CardDescription>
        </div>
        <Badge
          variant={
            summary.status === 'active_deterministic' ||
            summary.status === 'active_hybrid'
              ? 'secondary'
              : 'outline'
          }
        >
          {STATUS_COPY[summary.status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Metric
            label="Conversations"
            value={String(summary.metrics.conversations)}
          />
          <Metric label="Analyzed" value={String(summary.metrics.analyzed)} />
          <Metric
            label="Analyzed today"
            value={String(summary.metrics.analyzed_today)}
          />
          <Metric label="Waiting" value={String(summary.metrics.waiting)} />
          <Metric
            label="New sales events"
            value={String(summary.metrics.new_sales_events)}
          />
          <Metric
            label="New insights"
            value={String(summary.metrics.insight_count)}
          />
          <Metric
            label="Emerging patterns"
            value={String(summary.metrics.emerging_pattern_count)}
          />
          <Metric
            label="Strong patterns"
            value={String(summary.metrics.strong_pattern_count)}
          />
          <Metric
            label="Customer trends"
            value={String(summary.metrics.customer_trend_count)}
          />
          {summary.metrics.recommendation_signal_count != null ? (
            <Metric
              label="Recommendation signals"
              value={String(summary.metrics.recommendation_signal_count)}
            />
          ) : null}
          <Metric
            label="Last analyzed"
            value={formatWhen(summary.metrics.last_analyzed_at)}
          />
        </div>

        {summary.empty_state ? (
          <div className="border-border bg-muted/30 rounded-lg border p-4">
            <p className="text-foreground text-sm font-medium">
              No evidence-backed insights yet
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {summary.empty_state}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="text-foreground text-sm font-semibold">
              What Vachat learned
            </h3>
            <div className="grid gap-3 lg:grid-cols-2">
              {summary.insights.map((insight) => (
                <div
                  key={insight.id}
                  className="border-border rounded-lg border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-foreground text-sm font-medium">
                      {insight.title}
                    </p>
                    <Badge
                      variant={
                        insight.strength === 'strong' ? 'secondary' : 'outline'
                      }
                    >
                      {STRENGTH_COPY[insight.strength]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-2 text-sm">
                    {insight.summary}
                  </p>
                  <p className="text-muted-foreground mt-3 text-xs">
                    Evidence: {evidenceCopy(insight)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {onNavigate ? (
          <div className="border-border flex flex-wrap gap-2 border-t pt-4">
            <span className="text-muted-foreground mr-1 self-center text-xs">
              View details
            </span>
            {(
              [
                ['events', 'Sales events'],
                ['patterns', 'Sales patterns'],
                ['shadow', 'Shadow quality'],
                ['operations', 'Operations'],
              ] as const
            ).map(([destination, label]) => (
              <Button
                key={destination}
                variant="outline"
                size="sm"
                onClick={() => onNavigate(destination)}
              >
                {label}
              </Button>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OverviewCards({ data }: { data: IntelligenceOverview }) {
  const knowledgeValue = !data.knowledge.available
    ? UNAVAILABLE_COPY
    : data.knowledge.document_count > 0
      ? String(data.knowledge.document_count)
      : NO_DATA_COPY;
  const patternTotal = Object.values(data.patterns.by_status).reduce(
    (sum, n) => sum + n,
    0
  );
  const experimentTotal = Object.values(data.experiments.by_status).reduce(
    (sum, n) => sum + n,
    0
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Business Knowledge</CardTitle>
          <CardDescription>Sources your AI can cite</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Metric label="Knowledge sources" value={knowledgeValue} />
          <Metric
            label="Last updated"
            value={
              data.knowledge.available
                ? formatWhen(data.knowledge.last_updated_at)
                : UNAVAILABLE_COPY
            }
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Sales Patterns</CardTitle>
          <CardDescription>Learned sales intelligence</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data.patterns.available ? (
            <p className="text-muted-foreground text-sm">{UNAVAILABLE_COPY}</p>
          ) : patternTotal === 0 ? (
            <p className="text-muted-foreground text-sm">{NO_DATA_COPY}</p>
          ) : (
            <>
              <Metric
                label="Active"
                value={String(data.patterns.by_status.active ?? 0)}
              />
              <Metric
                label="Retrieval eligible"
                value={String(data.patterns.retrieval_eligible_count)}
              />
              <Metric
                label="With observed effectiveness"
                value={String(data.patterns.with_effectiveness_count)}
              />
              <Metric
                label="Last observed"
                value={formatWhen(data.patterns.last_observed_at)}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Pattern Effectiveness</CardTitle>
          <CardDescription>Observational outcomes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data.patterns.available ? (
            <p className="text-muted-foreground text-sm">{UNAVAILABLE_COPY}</p>
          ) : data.patterns.with_effectiveness_count === 0 &&
            data.patterns.underperforming_count === 0 ? (
            <p className="text-muted-foreground text-sm">{NO_DATA_COPY}</p>
          ) : (
            <>
              <Metric
                label="With measurable outcomes"
                value={String(data.patterns.with_effectiveness_count)}
              />
              <Metric
                label="Underperforming"
                value={String(data.patterns.underperforming_count)}
              />
            </>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Experiments</CardTitle>
          <CardDescription>Controlled AI optimization</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data.experiments.available ? (
            <p className="text-muted-foreground text-sm">{UNAVAILABLE_COPY}</p>
          ) : experimentTotal === 0 ? (
            <p className="text-muted-foreground text-sm">{NO_DATA_COPY}</p>
          ) : (
            <>
              <Metric
                label="Running"
                value={String(data.experiments.by_status.running ?? 0)}
              />
              <Metric
                label="Evaluating"
                value={String(data.experiments.by_status.evaluating ?? 0)}
              />
              <Metric
                label="Approved"
                value={String(data.experiments.by_status.approved ?? 0)}
              />
              <Metric
                label="Draft"
                value={String(data.experiments.by_status.draft ?? 0)}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function OverviewTab({
  onNavigate,
}: {
  onNavigate?: (destination: OverviewDestination) => void;
}) {
  const [data, setData] = useState<IntelligenceOverview | null>(null);
  const [summary, setSummary] = useState<MerchantLearningSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [overview, nextSummary] = await Promise.all([
          fetchOverview(),
          fetchLearningSummary(),
        ]);
        if (!cancelled) {
          setData(overview);
          setSummary(nextSummary);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load overview'
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-muted-foreground text-sm">{error}</p>;
  }
  if (!data || !summary) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <LearningSummaryCard summary={summary} onNavigate={onNavigate} />
      <OverviewCards data={data} />
    </div>
  );
}
