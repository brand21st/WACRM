/**
 * End-to-end checks for AI Intelligence after Phase 3–6 schema restore.
 *
 * Layer 1 — route handlers + live DB (auth mocked; supabaseAdmin is real).
 * Layer 2 — localhost HTTP. Unauthenticated GETs must 401. Signed-in GETs
 *           run when E2E_COOKIE is set (never PATCH/POST).
 * Layer 3 — admin UI copy from the live overview payload.
 *
 * Skips when .env.local is missing. Never writes flags or experiments.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverviewCards } from '@/components/ai-intelligence/overview-tab';
import type { IntelligenceOverview } from '@/components/ai-intelligence/api';
import {
  NO_DATA_COPY,
  NO_EXPERIMENTS_COPY,
  NO_PATTERNS_COPY,
  UNAVAILABLE_COPY,
} from '@/components/ai-intelligence/view-model';

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

import { createClient } from '@supabase/supabase-js';
import { GET as getOverview } from '@/app/api/ai/intelligence/overview/route';
import { GET as getEvents } from '@/app/api/ai/intelligence/events/route';
import { GET as getVolume } from '@/app/api/ai/intelligence/volume/route';
import { GET as getShadow } from '@/app/api/ai/intelligence/shadow/route';
import { GET as getPatterns } from '@/app/api/ai/patterns/route';
import { GET as getPatternById } from '@/app/api/ai/patterns/[id]/route';
import { GET as getPatternConfig } from '@/app/api/ai/patterns/config/route';
import { GET as getExperiments } from '@/app/api/ai/behavior-experiments/route';
import { GET as getExperimentById } from '@/app/api/ai/behavior-experiments/[id]/route';
import { GET as getExperimentConfig } from '@/app/api/ai/behavior-experiments/config/route';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(url && serviceKey);
const FOREIGN_ID = '00000000-0000-4000-8000-000000000099';
const E2E_BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const E2E_COOKIE = process.env.E2E_COOKIE;

function assertNoSchemaLeak(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(
    /sales_events|sales_patterns|42P01|PGRST205|relation|supabase/i
  );
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe.skipIf(!live)('AI Intelligence e2e — live API + UI', () => {
  const db = createClient(url!, serviceKey!);
  let accountId = '';

  beforeAll(async () => {
    const { data, error } = await db
      .from('ai_configs')
      .select('account_id')
      .limit(1)
      .maybeSingle();
    if (error || !data?.account_id) {
      throw new Error('expected an ai_configs row for live e2e tests');
    }
    accountId = data.account_id as string;
    mocks.requireRole.mockResolvedValue({
      accountId,
      userId: 'e2e-admin',
      role: 'admin',
    });
  });

  it('overview, patterns, and experiment GETs stay available, empty, and off', async () => {
    const [
      overviewRes,
      eventsRes,
      volumeRes,
      shadowRes,
      patternsRes,
      patternConfigRes,
      experimentsRes,
      experimentConfigRes,
    ] = await Promise.all([
      getOverview(),
      getEvents(),
      getVolume(),
      getShadow(),
      getPatterns(),
      getPatternConfig(),
      getExperiments(),
      getExperimentConfig(),
    ]);

    expect(overviewRes.status).toBe(200);
    expect(eventsRes.status).toBe(200);
    expect(volumeRes.status).toBe(200);
    expect(shadowRes.status).toBe(200);
    expect(patternsRes.status).toBe(200);
    expect(patternConfigRes.status).toBe(200);
    expect(experimentsRes.status).toBe(200);
    expect(experimentConfigRes.status).toBe(200);

    const overview = (await readJson(
      overviewRes
    )) as unknown as IntelligenceOverview;
    const events = await readJson(eventsRes);
    const volume = await readJson(volumeRes);
    const shadow = await readJson(shadowRes);
    const patterns = await readJson(patternsRes);
    const patternConfig = await readJson(patternConfigRes);
    const experiments = await readJson(experimentsRes);
    const experimentConfig = await readJson(experimentConfigRes);

    expect(overview.patterns.available).toBe(true);
    expect(overview.experiments.available).toBe(true);
    expect(overview.flags.sales_pattern_retrieval).toBe('off');
    expect(overview.flags.ai_behavior_optimization).toBe('off');
    expect(overview.experiments.by_status.running ?? 0).toBe(0);
    expect(overview.experiments.by_status.draft ?? 0).toBe(0);
    if (overview.knowledge.available) {
      expect(overview.knowledge.document_count).toBeGreaterThanOrEqual(0);
    }

    expect(events.available).toBe(true);
    expect(events.total).toBeGreaterThanOrEqual(0);
    expect(volume.available).toBe(true);
    expect(volume.conversation_count).toBeGreaterThanOrEqual(0);
    expect(shadow.available).toBe(true);
    expect(shadow.eligible_turns).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify({ events, volume, shadow })).not.toMatch(
      /phone|email|transcript|content_text/i
    );
    expect(patterns).toEqual({ available: true, patterns: [] });
    expect(patternConfig).toEqual({ sales_pattern_retrieval: 'off' });
    expect(experiments).toEqual({ experiments: [] });
    expect(experimentConfig.ai_behavior_optimization).toBe('off');
    expect(experimentConfig.live_experiment).toBeNull();
    expect(experimentConfig.active_behavior).toBeNull();

    for (const body of [
      overview,
      events,
      volume,
      shadow,
      patterns,
      patternConfig,
      experiments,
      experimentConfig,
    ]) {
      assertNoSchemaLeak(body);
    }
  });

  it('foreign pattern and experiment ids 404 without leaking another tenant', async () => {
    const patternRes = await getPatternById(
      new Request(`http://localhost/api/ai/patterns/${FOREIGN_ID}`),
      { params: Promise.resolve({ id: FOREIGN_ID }) }
    );
    const experimentRes = await getExperimentById(
      new Request(`http://localhost/api/ai/behavior-experiments/${FOREIGN_ID}`),
      { params: Promise.resolve({ id: FOREIGN_ID }) }
    );
    expect(patternRes.status).toBe(404);
    expect(experimentRes.status).toBe(404);
    expect(await readJson(patternRes)).toEqual({ error: 'Not found' });
    expect(await readJson(experimentRes)).toEqual({ error: 'Not found' });
  });

  it('renders restored empty-state copy from the live overview payload', async () => {
    const overview = (await readJson(
      await getOverview()
    )) as unknown as IntelligenceOverview;
    const html = renderToStaticMarkup(
      React.createElement(OverviewCards, { data: overview })
    );
    expect(overview.patterns.available).toBe(true);
    expect(html).toContain(NO_DATA_COPY);
    expect(html).not.toContain(UNAVAILABLE_COPY);
    expect(html).not.toMatch(/sales_patterns|42P01|supabase/i);
    expect(NO_PATTERNS_COPY).toBe('No learned sales patterns yet.');
    expect(NO_EXPERIMENTS_COPY).toBe('No experiments yet.');
  });
});

describe('AI Intelligence e2e — localhost HTTP', () => {
  async function probe(): Promise<boolean> {
    try {
      const res = await fetch(`${E2E_BASE}/api/ai/intelligence/overview`, {
        redirect: 'manual',
      });
      return res.status !== 0;
    } catch {
      return false;
    }
  }

  it('rejects unauthenticated GETs with 401', async () => {
    if (!(await probe())) return;
    const paths = [
      '/api/ai/intelligence/overview',
      '/api/ai/intelligence/events',
      '/api/ai/intelligence/volume',
      '/api/ai/intelligence/shadow',
      '/api/ai/patterns',
      '/api/ai/patterns/config',
      '/api/ai/behavior-experiments',
      '/api/ai/behavior-experiments/config',
    ];
    const responses = await Promise.all(
      paths.map(async (path) => ({
        path,
        response: await fetch(`${E2E_BASE}${path}`, { redirect: 'manual' }),
      }))
    );
    await Promise.all(
      responses.map(async ({ path, response }) => {
        expect(response.status, path).toBe(401);
        const body = await readJson(response);
        expect(body.error).toBe('Unauthorized');
        assertNoSchemaLeak(body);
      })
    );
  });

  it.skipIf(!E2E_COOKIE)(
    'signed-in GETs match the restored empty intelligence state',
    async () => {
      if (!(await probe())) return;
      const cookie = E2E_COOKIE;
      if (!cookie) return;
      const headers: HeadersInit = { cookie };
      const [
        overviewRes,
        patternsRes,
        patternConfigRes,
        experimentsRes,
        experimentConfigRes,
        foreignPattern,
        foreignExperiment,
      ] = await Promise.all([
        fetch(`${E2E_BASE}/api/ai/intelligence/overview`, { headers }),
        fetch(`${E2E_BASE}/api/ai/patterns`, { headers }),
        fetch(`${E2E_BASE}/api/ai/patterns/config`, { headers }),
        fetch(`${E2E_BASE}/api/ai/behavior-experiments`, { headers }),
        fetch(`${E2E_BASE}/api/ai/behavior-experiments/config`, { headers }),
        fetch(`${E2E_BASE}/api/ai/patterns/${FOREIGN_ID}`, { headers }),
        fetch(`${E2E_BASE}/api/ai/behavior-experiments/${FOREIGN_ID}`, {
          headers,
        }),
      ]);

      expect(overviewRes.status).toBe(200);
      expect(patternsRes.status).toBe(200);
      expect(patternConfigRes.status).toBe(200);
      expect(experimentsRes.status).toBe(200);
      expect(experimentConfigRes.status).toBe(200);
      expect(foreignPattern.status).toBe(404);
      expect(foreignExperiment.status).toBe(404);

      const overview = (await readJson(
        overviewRes
      )) as unknown as IntelligenceOverview;
      expect(overview.patterns.available).toBe(true);
      expect(overview.flags.sales_pattern_retrieval).toBe('off');
      expect(overview.flags.ai_behavior_optimization).toBe('off');
      expect(await readJson(patternsRes)).toEqual({
        available: true,
        patterns: [],
      });
      expect(await readJson(patternConfigRes)).toEqual({
        sales_pattern_retrieval: 'off',
      });
      expect(await readJson(experimentsRes)).toEqual({ experiments: [] });
      const experimentConfig = await readJson(experimentConfigRes);
      expect(experimentConfig.ai_behavior_optimization).toBe('off');
      expect(experimentConfig.live_experiment).toBeNull();
      expect(await readJson(foreignPattern)).toEqual({ error: 'Not found' });
      expect(await readJson(foreignExperiment)).toEqual({ error: 'Not found' });
    }
  );
});
