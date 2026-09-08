export type CatalogEvalQuery = {
  id: string
  language: 'en' | 'ml' | 'mixed'
  query: string
  hard?: {
    maxPrice?: number
    minPrice?: number
    optionValue?: string
  }
  expect: {
    mustNotInventIds: true
    emptyIfHardMiss?: boolean
    notes?: string
  }
}

/** Labeled fixtures for offline hybrid-search review. Not a live OpenAI job. */
export const CATALOG_EVAL_QUERIES: CatalogEvalQuery[] = [
  {
    id: 'en-wedding-budget',
    language: 'en',
    query: 'wedding dress under 5k',
    hard: { maxPrice: 5000 },
    expect: {
      mustNotInventIds: true,
      emptyIfHardMiss: true,
      notes: 'Budget binds. Do not return over-budget neighbors.',
    },
  },
  {
    id: 'en-color-size',
    language: 'en',
    query: 'black bag size M',
    hard: { optionValue: 'M' },
    expect: { mustNotInventIds: true },
  },
  {
    id: 'ml-budget',
    language: 'ml',
    query: '5000 രൂപയ്ക്കുള്ളിൽ ഡ്രസ്സ്',
    hard: { maxPrice: 5000 },
    expect: {
      mustNotInventIds: true,
      emptyIfHardMiss: true,
      notes: 'Malayalam within-budget phrase.',
    },
  },
  {
    id: 'ml-occasion',
    language: 'ml',
    query: 'കല്യാണം ഡ്രസ്സ്',
    expect: {
      mustNotInventIds: true,
      notes: 'Occasion is a semantic signal unless the store has that attribute.',
    },
  },
  {
    id: 'mixed-manglish',
    language: 'mixed',
    query: 'weddinginu black dress 2000 thazhe',
    hard: { maxPrice: 2000, optionValue: 'black' },
    expect: {
      mustNotInventIds: true,
      emptyIfHardMiss: true,
    },
  },
  {
    id: 'mixed-ullil',
    language: 'mixed',
    query: 'red bag 1500 ullil',
    hard: { maxPrice: 1500 },
    expect: { mustNotInventIds: true, emptyIfHardMiss: true },
  },
]
