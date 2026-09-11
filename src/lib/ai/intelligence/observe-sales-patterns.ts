/**
 * Phase 5 shadow observation for the background conversation-analysis worker.
 * Customer text is used only in memory to classify the turn; diagnostics store
 * opaque source/pattern identities and bounded scoring metadata.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShoppingContext } from '@/lib/catalog/intelligence/types';
import { classifySalesTurn } from '@/lib/shopify/sales-turn';
import {
  loadSalesPatternRetrievalMode,
  logSalesPatternDiagnostics,
  persistSalesPatternShadowDiagnostics,
  retrieveSalesPatterns,
  salesPatternDiagnosticPayload,
} from './retrieve-sales-patterns';
import {
  shouldRetrieveSalesPatterns,
  situationFromTurn,
} from './sales-pattern-score';

export type PatternObservationTurn = {
  id: string;
  sender_type: string;
  content_text: string | null;
};

export type ObserveSalesPatternDeps = {
  loadMode?: typeof loadSalesPatternRetrievalMode;
  retrieve?: typeof retrieveSalesPatterns;
  log?: typeof logSalesPatternDiagnostics;
  persist?: typeof persistSalesPatternShadowDiagnostics;
  observedAt?: () => string;
};

export async function observeSalesPatternsInBackground(
  db: SupabaseClient,
  args: {
    accountId: string;
    turns: PatternObservationTurn[];
    shopping?: ShoppingContext | null;
    productId?: string | null;
  },
  deps: ObserveSalesPatternDeps = {}
): Promise<number> {
  const mode = await (deps.loadMode ?? loadSalesPatternRetrievalMode)(
    db,
    args.accountId
  );
  if (mode !== 'shadow') return 0;

  let observed = 0;
  for (const turn of args.turns) {
    const sourceTurnId = turn.id.trim();
    const queryText = turn.content_text?.trim() ?? '';
    if (turn.sender_type !== 'customer' || !sourceTurnId || !queryText)
      continue;

    const salesTurn = classifySalesTurn(queryText);
    if (!shouldRetrieveSalesPatterns(salesTurn, queryText)) continue;
    const situation = situationFromTurn({
      salesTurn,
      queryText,
      shopping: args.shopping,
      productId: args.productId,
    });
    if (!situation) continue;

    const matches = await (deps.retrieve ?? retrieveSalesPatterns)(db, {
      accountId: args.accountId,
      patternType: situation.patternType,
      shopping: args.shopping,
      productId: args.productId ?? situation.productId,
    });
    const payload = salesPatternDiagnosticPayload({
      accountId: args.accountId,
      sourceTurnId,
      observedAt: deps.observedAt?.(),
      matches,
      injected: false,
    });
    const log = deps.log ?? logSalesPatternDiagnostics;
    log(payload);
    await (deps.persist ?? persistSalesPatternShadowDiagnostics)(db, payload);
    observed += 1;
  }
  return observed;
}
