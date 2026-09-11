import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MissingAccountIdError } from './contracts'
import {
  AiBehaviorAdminError,
  approveAiBehaviorExperiment,
  createAiBehaviorExperiment,
  rollbackAiBehaviorExperiment,
  startAiBehaviorExperiment,
} from './ai-behavior-admin'

const unusedDb = {} as SupabaseClient

describe('ai-behavior-admin isolation', () => {
  it('fails before DB work when accountId is missing', async () => {
    await expect(
      createAiBehaviorExperiment(unusedDb, {
        accountId: '',
        name: 'test',
        variantBehavior: { replyStyle: 'concise' },
      })
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    await expect(
      startAiBehaviorExperiment(unusedDb, '', 'exp-1')
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    await expect(
      approveAiBehaviorExperiment(unusedDb, '', 'exp-1')
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    await expect(
      rollbackAiBehaviorExperiment(unusedDb, '', 'exp-1')
    ).rejects.toBeInstanceOf(MissingAccountIdError)
  })
})

describe('approve and rollback scoping', () => {
  it('approves only the exact candidate version', async () => {
    const updates: Array<Record<string, unknown>> = []
    const db = {
      from(table: string) {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          neq() {
            return this
          },
          in() {
            return this
          },
          maybeSingle: async () => {
            if (table === 'ai_configs') {
              return { data: { ai_behavior_optimization: 'on' }, error: null }
            }
            if (table === 'ai_behavior_experiments') {
              return {
                data: {
                  id: 'exp-1',
                  status: 'evaluating',
                  control_version_id: 'ver-control',
                  control_was_implicit: false,
                  candidate_winner_version_id: 'ver-variant',
                },
                error: null,
              }
            }
            return {
              data: { id: 'ver-variant', account_id: 'acct-a' },
              error: null,
            }
          },
          update(payload: Record<string, unknown>) {
            updates.push({ table, payload })
            return this
          },
          then(resolve: (value: { error: null }) => void) {
            resolve({ error: null })
          },
        }
      },
    } as unknown as SupabaseClient

    await approveAiBehaviorExperiment(db, 'acct-a', 'exp-1')
    const activated = updates.filter(
      (row) => row.table === 'ai_behavior_versions' && (row.payload as { status?: string }).status === 'active'
    )
    expect(activated).toHaveLength(1)
    const ended = updates.find(
      (row) =>
        row.table === 'ai_behavior_experiments' &&
        (row.payload as { status?: string }).status === 'approved'
    )
    expect(ended).toBeTruthy()
  })

  it('rejects approve without a candidate or when the flag is off', async () => {
    const off = {
      from() {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          maybeSingle: async () => ({
            data: { ai_behavior_optimization: 'off' },
            error: null,
          }),
        }
      },
    } as unknown as SupabaseClient
    await expect(
      approveAiBehaviorExperiment(off, 'acct-a', 'exp-1')
    ).rejects.toBeInstanceOf(AiBehaviorAdminError)

    const noWinner = {
      from(table: string) {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          maybeSingle: async () => {
            if (table === 'ai_configs') {
              return { data: { ai_behavior_optimization: 'on' }, error: null }
            }
            return {
              data: {
                id: 'exp-1',
                status: 'evaluating',
                control_version_id: 'ver-control',
                control_was_implicit: false,
                candidate_winner_version_id: null,
              },
              error: null,
            }
          },
        }
      },
    } as unknown as SupabaseClient
    await expect(
      approveAiBehaviorExperiment(noWinner, 'acct-a', 'exp-1')
    ).rejects.toMatchObject({ message: 'no candidate winner' })
  })

  it('rollbacks implicit control to no active version and explicit control to the exact id', async () => {
    const archived: string[] = []
    const implicitDb = {
      from(table: string) {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          maybeSingle: async () => ({
            data: {
              id: 'exp-1',
              status: 'running',
              control_version_id: 'ver-snapshot',
              control_was_implicit: true,
              candidate_winner_version_id: null,
            },
            error: null,
          }),
          update(payload: Record<string, unknown>) {
            if (
              table === 'ai_behavior_versions' &&
              (payload.status as string) === 'archived'
            ) {
              archived.push('implicit-clear')
            }
            return this
          },
          then(resolve: (value: { error: null }) => void) {
            resolve({ error: null })
          },
        }
      },
    } as unknown as SupabaseClient
    await rollbackAiBehaviorExperiment(implicitDb, 'acct-a', 'exp-1')
    expect(archived).toContain('implicit-clear')

    const activated: string[] = []
    const explicitDb = {
      from(table: string) {
        return {
          select() {
            return this
          },
          eq(column: string, value: unknown) {
            if (table === 'ai_behavior_versions' && column === 'id') {
              activated.push(String(value))
            }
            return this
          },
          neq() {
            return this
          },
          maybeSingle: async () => {
            if (table === 'ai_behavior_experiments') {
              return {
                data: {
                  id: 'exp-1',
                  status: 'approved',
                  control_version_id: 'ver-control-exact',
                  control_was_implicit: false,
                  candidate_winner_version_id: 'ver-variant',
                },
                error: null,
              }
            }
            return {
              data: { id: 'ver-control-exact', account_id: 'acct-a' },
              error: null,
            }
          },
          update() {
            return this
          },
          then(resolve: (value: { error: null }) => void) {
            resolve({ error: null })
          },
        }
      },
    } as unknown as SupabaseClient
    await rollbackAiBehaviorExperiment(explicitDb, 'acct-a', 'exp-1')
    expect(activated).toContain('ver-control-exact')
    expect(activated).not.toContain('ver-variant')
  })

  it('returns 404-style error for a missing experiment in this account', async () => {
    const db = {
      from() {
        return {
          select() {
            return this
          },
          eq() {
            return this
          },
          maybeSingle: async () => ({ data: null, error: null }),
        }
      },
    } as unknown as SupabaseClient
    await expect(
      rollbackAiBehaviorExperiment(db, 'acct-a', 'exp-other')
    ).rejects.toMatchObject({ status: 404 })
  })
})
