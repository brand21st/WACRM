import type { SalesStage } from './types'

export type SalesStageSignals = {
  seedId?: string | null
  selectedIds?: string[]
  shownIds?: string[]
  hasCart?: boolean
  hasPendingCheckout?: boolean
  hasPaidOrder?: boolean
  complementaryAsk?: boolean
}

/**
 * Derived shopping stage for recommend ranking only.
 * Never write this onto conversations.ai_product_focus.stage.
 */
export function deriveSalesStage(signals: SalesStageSignals): SalesStage {
  if (signals.hasPaidOrder && signals.complementaryAsk) return 'post_purchase'
  if (signals.hasPaidOrder) return 'purchased'
  if (signals.hasPendingCheckout) return 'checkout'
  if (signals.hasCart) return 'cart'
  if (signals.seedId || (signals.selectedIds?.length ?? 0) > 0) {
    return 'product_selected'
  }
  if ((signals.shownIds?.length ?? 0) > 0) return 'consideration'
  return 'discovery'
}

export function isComplementaryAsk(mode: string | null | undefined): boolean {
  return mode === 'cross_sell' || mode === 'bundle' || mode === 'upsell'
}
