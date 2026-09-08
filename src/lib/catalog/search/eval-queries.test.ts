import { describe, expect, it } from 'vitest'
import { parseShoppingRequirements } from '../intelligence/requirements'
import { CATALOG_EVAL_QUERIES } from './eval-queries'
import { parseBudget } from '@/lib/shopify/rank'

describe('CATALOG_EVAL_QUERIES', () => {
  it('covers English, Malayalam, and mixed asks without invented ids', () => {
    const languages = new Set(CATALOG_EVAL_QUERIES.map((row) => row.language))
    expect(languages).toEqual(new Set(['en', 'ml', 'mixed']))
    expect(CATALOG_EVAL_QUERIES.every((row) => row.expect.mustNotInventIds)).toBe(true)
  })

  it('parses hard budgets from the labeled queries', () => {
    for (const row of CATALOG_EVAL_QUERIES) {
      if (row.hard?.maxPrice == null) continue
      const budget = parseBudget(row.query)
      const reqs = parseShoppingRequirements(row.query)
      expect(budget?.max ?? reqs.maxPrice).toBe(row.hard.maxPrice)
    }
  })
})
