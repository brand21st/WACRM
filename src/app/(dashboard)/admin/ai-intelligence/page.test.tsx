import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  LearningSummaryCard,
  OverviewCards,
} from '@/components/ai-intelligence/overview-tab';
import {
  ANALYZE_RECENT_CONFIRMATION,
  ANALYZE_RECENT_HELP,
  LEARNING_UNAVAILABLE_COPY,
  NO_DATA_COPY,
  NO_EVENTS_COPY,
  NO_EXPERIMENTS_COPY,
  NO_PATTERNS_COPY,
  NO_SHADOW_COPY,
  START_FLAG_OFF_COPY,
  UNAVAILABLE_COPY,
} from '@/components/ai-intelligence/view-model';
import type {
  IntelligenceOverview,
  MerchantLearningSummary,
} from '@/components/ai-intelligence/api';

const emptyOverview: IntelligenceOverview = {
  knowledge: { available: true, document_count: 0, last_updated_at: null },
  patterns: {
    available: true,
    by_status: { candidate: 0, active: 0, stale: 0, archived: 0 },
    retrieval_eligible_count: 0,
    with_effectiveness_count: 0,
    underperforming_count: 0,
    last_observed_at: null,
  },
  experiments: {
    available: true,
    by_status: {
      draft: 0,
      running: 0,
      evaluating: 0,
      approved: 0,
      rolled_back: 0,
      archived: 0,
    },
  },
  flags: {
    sales_pattern_retrieval: 'off',
    ai_behavior_optimization: 'off',
  },
};

const offSummary: MerchantLearningSummary = {
  available: false,
  status: 'not_installed',
  window_days: 7,
  metrics: {
    conversations: 94,
    analyzed: 0,
    analyzed_today: 0,
    waiting: 94,
    new_sales_events: 0,
    insight_count: 0,
    emerging_pattern_count: 0,
    strong_pattern_count: 0,
    recommendation_signal_count: null,
    customer_trend_count: 0,
    last_analyzed_at: null,
  },
  insights: [],
  empty_state:
    'Background learning is not installed on this database yet. 94 conversations are waiting. Deterministic analysis will not change customer replies.',
};

describe('AI Intelligence admin UI copy', () => {
  it('renders No data yet when counts are empty', () => {
    const html = renderToStaticMarkup(
      React.createElement(OverviewCards, { data: emptyOverview })
    );
    expect(html).toContain(NO_DATA_COPY);
    expect(html).not.toContain('evaluating patterns');
  });

  it('renders unavailable intelligence copy when patterns are missing', () => {
    const html = renderToStaticMarkup(
      React.createElement(OverviewCards, {
        data: {
          ...emptyOverview,
          patterns: { ...emptyOverview.patterns, available: false },
          knowledge: { ...emptyOverview.knowledge, available: false },
        },
      })
    );
    expect(html).toContain(UNAVAILABLE_COPY);
    expect(html).not.toMatch(/sales_patterns|42P01|supabase/i);
  });

  it('keeps create/start/empty confirmation copy for UI tests', () => {
    expect(NO_PATTERNS_COPY).toBe('No learned sales patterns yet.');
    expect(NO_EVENTS_COPY).toBe('No sales events observed yet.');
    expect(NO_SHADOW_COPY).toBe('No shadow retrieval diagnostics yet.');
    expect(NO_EXPERIMENTS_COPY).toBe('No experiments yet.');
    expect(START_FLAG_OFF_COPY).toMatch(/Enable it in Settings/);
    expect(LEARNING_UNAVAILABLE_COPY).toMatch(/not installed/);
    expect(ANALYZE_RECENT_CONFIRMATION).toBe('ANALYZE RECENT CONVERSATIONS');
    expect(ANALYZE_RECENT_HELP).toMatch(/does not analyze all recent conversations/);
  });

  it('renders the safe merchant learning summary when learning is unavailable', () => {
    const html = renderToStaticMarkup(
      React.createElement(LearningSummaryCard, { summary: offSummary })
    );
    expect(html).toContain('AI Learning Summary');
    expect(html).toContain('Not installed');
    expect(html).toContain('94 conversations are waiting');
    expect(html).toContain('Customer replies stay unchanged');
    expect(html).not.toContain('What Vachat learned');
  });

  it('renders evidence and confidence without causal claims', () => {
    const html = renderToStaticMarkup(
      React.createElement(LearningSummaryCard, {
        summary: {
          ...offSummary,
          available: true,
          status: 'active_deterministic',
          empty_state: null,
          metrics: {
            ...offSummary.metrics,
            analyzed: 94,
            waiting: 0,
            insight_count: 1,
            emerging_pattern_count: 1,
            last_analyzed_at: '2026-09-11T05:00:00.000Z',
          },
          insights: [
            {
              id: 'event:PRICE_OBJECTION',
              strength: 'observed',
              sourceLayer: 'sales_event',
              title: 'Price objections observed',
              summary: 'Price objections appeared 9 times in the last 7 days.',
              evidence: {
                windowDays: 7,
                sampleSize: 9,
                signalCount: 9,
                outcomeCount: 0,
                successCount: 0,
                failureCount: 0,
                unresolvedCount: 0,
              },
            },
          ],
        },
      })
    );
    expect(html).toContain('What Vachat learned');
    expect(html).toContain('Observed');
    expect(html).toContain('Evidence: 9 observations · 7-day window');
    expect(html).not.toMatch(/caused|guaranteed/i);
  });

  it('labels lifetime pattern evidence instead of a 0-day window', () => {
    const html = renderToStaticMarkup(
      React.createElement(LearningSummaryCard, {
        summary: {
          ...offSummary,
          available: true,
          status: 'active_deterministic',
          empty_state: null,
          insights: [
            {
              id: 'pattern:p-strong',
              strength: 'strong',
              sourceLayer: 'sales_pattern',
              title: 'Product comparison pattern',
              summary: 'Strong evidence appeared across 20 observations.',
              evidence: {
                windowDays: 0,
                sampleSize: 20,
                signalCount: 20,
                outcomeCount: 7,
                successCount: 5,
                failureCount: 2,
                unresolvedCount: 13,
              },
            },
          ],
        },
      })
    );
    expect(html).toContain('lifetime evidence');
    expect(html).not.toContain('0-day window');
  });
});
