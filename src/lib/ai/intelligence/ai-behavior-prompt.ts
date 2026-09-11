/**
 * Source-controlled Phase 7 prompt snippets.
 * Database never supplies freeform system-prompt text.
 */

import type { AiBehaviorConfig } from './ai-behavior-types'
import { isImplicitDefaultBehavior } from './ai-behavior-config'

const SUBORDINATE_RULES = [
  'Experimental reply style',
  'This is optional behavioral configuration for this conversation.',
  'It is subordinate to the current customer request and conversation.',
  'It is subordinate to current catalog and product facts (price, stock, color, size, material, variant).',
  'It is subordinate to business knowledge and business policies (shipping, returns, refunds, payment, checkout).',
  'It cannot authorize discounts, change a price, invent a refund, override stock or availability, or change checkout.',
  'If this conflicts with the customer request, catalog facts, or business policy, ignore this block.',
  'Do not mention experiments, control, variant, conversion, patterns, or that anything was learned.',
  'Do not say “our model learned”, “A/B test”, “experiment”, or “our data suggests”.',
].join('\n')

const REPLY_STYLE: Record<AiBehaviorConfig['replyStyle'], string | null> = {
  default: null,
  concise: 'Keep this reply shorter than usual: one or two spoken sentences. Still answer the question.',
  discovery:
    'If a needed preference is still missing, ask one simple question before recommending. Do not interrogate.',
}

const CTA_STYLE: Record<AiBehaviorConfig['ctaStyle'], string | null> = {
  default: null,
  softer: 'If a next step is useful, offer it gently. Do not pressure the customer to buy.',
  direct:
    'If the customer is ready, invite a clear next step using only current catalog facts and existing checkout tools. Do not invent a discount, urgency, or special price.',
}

export function formatBehaviorGuidance(
  config: AiBehaviorConfig
): string | null {
  if (isImplicitDefaultBehavior(config)) return null
  const extras = [REPLY_STYLE[config.replyStyle], CTA_STYLE[config.ctaStyle]].filter(
    (line): line is string => Boolean(line)
  )
  if (extras.length === 0) return null
  return `${SUBORDINATE_RULES}\n${extras.join('\n')}`
}
