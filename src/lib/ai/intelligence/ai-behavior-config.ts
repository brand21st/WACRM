/**
 * Strict allowlist for Phase 7 behavior JSON.
 * Database stores configuration. Source code defines behavior.
 */

import {
  IMPLICIT_DEFAULT_BEHAVIOR,
  type AiBehaviorConfig,
  type CtaStyle,
  type InjectSalesGuidance,
  type ReplyStyle,
} from './ai-behavior-types'

const INJECT = new Set<InjectSalesGuidance>(['inherit', 'omit'])
const REPLY = new Set<ReplyStyle>(['default', 'concise', 'discovery'])
const CTA = new Set<CtaStyle>(['default', 'softer', 'direct'])
const ALLOWED_KEYS = new Set([
  'injectSalesGuidance',
  'replyStyle',
  'ctaStyle',
])

export class InvalidAiBehaviorConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAiBehaviorConfigError'
  }
}

export function parseAiBehaviorConfig(raw: unknown): AiBehaviorConfig {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidAiBehaviorConfigError('behavior must be an object')
  }
  const record = raw as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new InvalidAiBehaviorConfigError(`unknown behavior key: ${key}`)
    }
  }
  const inject = record.injectSalesGuidance ?? IMPLICIT_DEFAULT_BEHAVIOR.injectSalesGuidance
  const reply = record.replyStyle ?? IMPLICIT_DEFAULT_BEHAVIOR.replyStyle
  const cta = record.ctaStyle ?? IMPLICIT_DEFAULT_BEHAVIOR.ctaStyle
  if (typeof inject !== 'string' || !INJECT.has(inject as InjectSalesGuidance)) {
    throw new InvalidAiBehaviorConfigError('invalid injectSalesGuidance')
  }
  if (typeof reply !== 'string' || !REPLY.has(reply as ReplyStyle)) {
    throw new InvalidAiBehaviorConfigError('invalid replyStyle')
  }
  if (typeof cta !== 'string' || !CTA.has(cta as CtaStyle)) {
    throw new InvalidAiBehaviorConfigError('invalid ctaStyle')
  }
  return {
    injectSalesGuidance: inject as InjectSalesGuidance,
    replyStyle: reply as ReplyStyle,
    ctaStyle: cta as CtaStyle,
  }
}

export function isImplicitDefaultBehavior(config: AiBehaviorConfig): boolean {
  return (
    config.injectSalesGuidance === 'inherit' &&
    config.replyStyle === 'default' &&
    config.ctaStyle === 'default'
  )
}

export function applySalesGuidancePolicy(
  config: AiBehaviorConfig,
  salesGuidance: string | null
): string | null {
  if (config.injectSalesGuidance === 'omit') return null
  return salesGuidance
}
