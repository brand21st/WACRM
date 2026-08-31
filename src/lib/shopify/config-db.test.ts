import { describe, expect, it } from 'vitest'
import {
  isMissingClientIdColumn,
  isMissingDbColumn,
  isMissingDbFunction,
  isMissingDbRelation,
} from './config-db'

describe('isMissingDbColumn', () => {
  it('matches PostgREST missing-column errors by name', () => {
    const err = {
      code: 'PGRST204',
      message:
        "Could not find the 'body' column of 'shopify_catalog_products' in the schema cache",
    }
    expect(isMissingDbColumn(err, 'body')).toBe(true)
    expect(isMissingClientIdColumn(err)).toBe(false)
  })

  it('matches client_id errors without treating every PGRST204 as client_id', () => {
    expect(
      isMissingClientIdColumn({
        code: 'PGRST204',
        message: "Could not find the 'client_id' column of 'shopify_configs' in the schema cache",
      }),
    ).toBe(true)
    expect(
      isMissingClientIdColumn({
        code: 'PGRST204',
        message:
          "Could not find the 'last_content_sync_at' column of 'shopify_configs' in the schema cache",
      }),
    ).toBe(false)
  })
})

describe('isMissingDbRelation', () => {
  it('matches a missing shopify_store_content table', () => {
    expect(
      isMissingDbRelation(
        {
          code: 'PGRST205',
          message:
            "Could not find the table 'public.shopify_store_content' in the schema cache",
        },
        'shopify_store_content',
      ),
    ).toBe(true)
    expect(isMissingDbFunction({ code: 'PGRST202', message: 'missing rpc' })).toBe(
      true,
    )
  })
})
