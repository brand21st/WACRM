'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { GatedButton } from '@/components/ui/gated-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { AiBehaviorConfig } from '@/lib/ai/intelligence/ai-behavior-types'
import { IMPLICIT_DEFAULT_BEHAVIOR } from '@/lib/ai/intelligence/ai-behavior-types'
import {
  IntelligenceApiError,
  approveExperiment,
  createExperiment,
  fetchExperiment,
  fetchExperimentConfig,
  fetchExperiments,
  rollbackExperiment,
  startExperiment,
  type ExperimentDetail,
  type ExperimentRow,
} from './api'
import {
  CANDIDATE_COPY,
  CAUSAL_DISCLAIMER,
  EVALUATING_COPY,
  NO_EXPERIMENTS_COPY,
  NO_EXPERIMENTS_SUB,
  PERMISSION_COPY,
  STATUS_LABELS,
  canApprove,
  canRollback,
  canStart,
  controlLabel,
  eligibleOutcomesFromEvaluation,
  formatImprovement,
  formatPercent,
  formatWhen,
  hasCandidate,
  observedResultLabel,
  startBlockedReason,
  summarizeBehavior,
} from './view-model'

function statusBadgeClass(status: string): string {
  if (status === 'running') {
    return 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
  }
  if (status === 'evaluating') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  }
  if (status === 'approved') {
    return 'border-primary/40 bg-primary/10 text-primary'
  }
  return 'border-border bg-muted text-muted-foreground'
}

function ArmCard({
  title,
  metrics,
}: {
  title: string
  metrics: NonNullable<ExperimentRow['evaluation']>['control']
}) {
  if (!metrics) return null
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {metrics.eligibleOutcomeCount} eligible outcomes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        <p>Assigned: {metrics.assignedCount}</p>
        <p>Success: {metrics.successCount}</p>
        <p>Failure: {metrics.failureCount}</p>
        <p>Unresolved: {metrics.unresolvedCount}</p>
        <p>Observed success: {formatPercent(metrics.observedSuccessRate)}</p>
        <p>Failure rate: {formatPercent(metrics.failureRate)}</p>
      </CardContent>
    </Card>
  )
}

export function ExperimentsTab({
  canAct,
  openCreateSignal = 0,
}: {
  canAct: boolean
  openCreateSignal?: number
}) {
  const [rows, setRows] = useState<ExperimentRow[]>([])
  const [optimization, setOptimization] = useState<'off' | 'on'>('off')
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ExperimentDetail | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [startId, setStartId] = useState<string | null>(null)
  const [approveId, setApproveId] = useState<string | null>(null)
  const [rollbackId, setRollbackId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [allocation, setAllocation] = useState(50)
  const [inject, setInject] = useState<AiBehaviorConfig['injectSalesGuidance']>(
    'inherit',
  )
  const [replyStyle, setReplyStyle] =
    useState<AiBehaviorConfig['replyStyle']>('default')
  const [ctaStyle, setCtaStyle] =
    useState<AiBehaviorConfig['ctaStyle']>('default')
  const [understood, setUnderstood] = useState(false)

  const refresh = useCallback(async () => {
    const [list, config] = await Promise.all([
      fetchExperiments(),
      fetchExperimentConfig(),
    ])
    setRows(list)
    setOptimization(config.ai_behavior_optimization)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refresh()
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load experiments')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  useEffect(() => {
    if (openCreateSignal > 0) setCreateOpen(true)
  }, [openCreateSignal])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const next = await fetchExperiment(selectedId)
        if (!cancelled) setDetail(next)
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load experiment')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  async function loadConfirmDetail(id: string): Promise<ExperimentDetail | null> {
    try {
      return await fetchExperiment(id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load experiment')
      return null
    }
  }

  function handleApiError(err: unknown) {
    if (err instanceof IntelligenceApiError && err.status === 403) {
      toast.error(PERMISSION_COPY)
      return
    }
    toast.error(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
  }

  async function handleCreate() {
    if (!understood || !name.trim()) return
    setBusy(true)
    try {
      await createExperiment({
        name: name.trim(),
        objective: objective.trim(),
        variant_allocation: allocation,
        behavior: {
          injectSalesGuidance: inject,
          replyStyle,
          ctaStyle,
        },
      })
      toast.success('Draft experiment created')
      setCreateOpen(false)
      setName('')
      setObjective('')
      setAllocation(50)
      setInject('inherit')
      setReplyStyle('default')
      setCtaStyle('default')
      setUnderstood(false)
      await refresh()
    } catch (err) {
      handleApiError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleStart() {
    if (!startId) return
    const blocked = startBlockedReason(optimization)
    if (blocked) {
      toast.error(blocked)
      return
    }
    setBusy(true)
    try {
      await startExperiment(startId)
      toast.success('Experiment started')
      setStartId(null)
      await refresh()
    } catch (err) {
      handleApiError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleApprove() {
    if (!approveId) return
    setBusy(true)
    try {
      await approveExperiment(approveId)
      toast.success('Variant approved as active behavior')
      setApproveId(null)
      setSelectedId(approveId)
      await refresh()
    } catch (err) {
      handleApiError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleRollback() {
    if (!rollbackId) return
    setBusy(true)
    try {
      await rollbackExperiment(rollbackId)
      toast.success('Experiment rolled back')
      setRollbackId(null)
      await refresh()
    } catch (err) {
      handleApiError(err)
    } finally {
      setBusy(false)
    }
  }

  const startDetail = startId && detail?.experiment.id === startId ? detail : null
  const approveDetail =
    approveId && detail?.experiment.id === approveId ? detail : null
  const rollbackDetail =
    rollbackId && detail?.experiment.id === rollbackId ? detail : null

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Controlled AI Experiments
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Safely test approved AI behavior changes against verified business
            outcomes.
          </p>
        </div>
        <GatedButton
          canAct={canAct}
          gateReason="create experiments"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Create Experiment
        </GatedButton>
      </div>

      <Alert>
        <AlertTitle>BETA — Controlled Experiments</AlertTitle>
        <AlertDescription>
          Experiments are evaluated on real business outcomes. No experiment
          changes business rules, pricing, catalog facts, or checkout behavior.
        </AlertDescription>
      </Alert>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {NO_EXPERIMENTS_COPY}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{NO_EXPERIMENTS_SUB}</p>
        </div>
      ) : (
        <div className="rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Control</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Eligible outcomes</TableHead>
                <TableHead>Observed result</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(row.id)}
                >
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusBadgeClass(row.status)}
                    >
                      {STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{controlLabel(row.control_was_implicit)}</TableCell>
                  <TableCell>Configured variant</TableCell>
                  <TableCell>{row.variant_allocation}%</TableCell>
                  <TableCell>{formatWhen(row.started_at)}</TableCell>
                  <TableCell>
                    {eligibleOutcomesFromEvaluation(row.evaluation) ?? '—'}
                  </TableCell>
                  <TableCell>
                    {observedResultLabel(
                      row.evaluation,
                      row.candidate_winner_version_id,
                    )}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <div className="flex flex-wrap gap-1">
                      {canStart(row.status) && (
                        <GatedButton
                          size="sm"
                          variant="outline"
                          canAct={canAct}
                          gateReason="start experiments"
                          onClick={async () => {
                            const next = await loadConfirmDetail(row.id)
                            if (next) setDetail(next)
                            setStartId(row.id)
                          }}
                        >
                          Start
                        </GatedButton>
                      )}
                      {canApprove(row) && (
                        <GatedButton
                          size="sm"
                          canAct={canAct}
                          gateReason="approve experiments"
                          onClick={async () => {
                            const next = await loadConfirmDetail(row.id)
                            if (next) setDetail(next)
                            setApproveId(row.id)
                          }}
                        >
                          Review & Approve
                        </GatedButton>
                      )}
                      {canRollback(row.status) && (
                        <GatedButton
                          size="sm"
                          variant="outline"
                          canAct={canAct}
                          gateReason="roll back experiments"
                          onClick={async () => {
                            const next = await loadConfirmDetail(row.id)
                            if (next) setDetail(next)
                            setRollbackId(row.id)
                          }}
                        >
                          Rollback
                        </GatedButton>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {detail && selectedId === detail.experiment.id && (
        <ExperimentDetailPanel experiment={detail} />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Experiment</DialogTitle>
            <DialogDescription>
              Experiments are BETA and affect live customer conversations when
              enabled. Creating a draft does not change live behavior.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="exp-name">Experiment name</Label>
              <Input
                id="exp-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-objective">Objective</Label>
              <Textarea
                id="exp-objective"
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-alloc">Variant allocation (1–99)</Label>
              <Input
                id="exp-alloc"
                type="number"
                min={1}
                max={99}
                value={allocation}
                onChange={(event) =>
                  setAllocation(Number(event.target.value) || 0)
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Control is an automatic snapshot of current production behavior.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Sales guidance</Label>
                <Select
                  value={inject}
                  onValueChange={(value) => {
                    if (value === 'inherit' || value === 'omit') setInject(value)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">inherit</SelectItem>
                    <SelectItem value="omit">omit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reply style</Label>
                <Select
                  value={replyStyle}
                  onValueChange={(value) => {
                    if (
                      value === 'default' ||
                      value === 'concise' ||
                      value === 'discovery'
                    ) {
                      setReplyStyle(value)
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">default</SelectItem>
                    <SelectItem value="concise">concise</SelectItem>
                    <SelectItem value="discovery">discovery</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>CTA style</Label>
                <Select
                  value={ctaStyle}
                  onValueChange={(value) => {
                    if (
                      value === 'default' ||
                      value === 'softer' ||
                      value === 'direct'
                    ) {
                      setCtaStyle(value)
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">default</SelectItem>
                    <SelectItem value="softer">softer</SelectItem>
                    <SelectItem value="direct">direct</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={understood}
                onCheckedChange={(checked) => setUnderstood(checked === true)}
              />
              I understand this experiment changes AI behavior for a portion of
              conversations.
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <GatedButton
              canAct={canAct}
              gateReason="create experiments"
              disabled={!understood || !name.trim() || busy}
              onClick={handleCreate}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Create draft
            </GatedButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={startId != null}
        onOpenChange={(open) => {
          if (!open) setStartId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start this experiment?</DialogTitle>
            <DialogDescription>
              New customer conversations may receive the experimental AI
              behavior.
            </DialogDescription>
          </DialogHeader>
          {startBlockedReason(optimization) ? (
            <p className="text-sm text-amber-300">
              {startBlockedReason(optimization)}
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Control: </span>
                {summarizeBehavior(
                  startDetail?.control_behavior ?? IMPLICIT_DEFAULT_BEHAVIOR,
                )}
              </p>
              <p>
                <span className="text-muted-foreground">Variant: </span>
                {summarizeBehavior(startDetail?.variant_behavior ?? null)}
              </p>
              <p>
                Traffic: {startDetail?.experiment.variant_allocation ?? 50}%
                variant / {100 - (startDetail?.experiment.variant_allocation ?? 50)}
                % control
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setStartId(null)}>
              Cancel
            </Button>
            <GatedButton
              canAct={canAct && !startBlockedReason(optimization)}
              gateReason="start experiments"
              disabled={busy}
              onClick={handleStart}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Start experiment
            </GatedButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={approveId != null}
        onOpenChange={(open) => {
          if (!open) setApproveId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve variant as active AI behavior?</DialogTitle>
            <DialogDescription>
              After approval, new conversations will use this behavior
              configuration.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {summarizeBehavior(approveDetail?.variant_behavior ?? null)}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setApproveId(null)}>
              Cancel
            </Button>
            <GatedButton
              canAct={canAct}
              gateReason="approve experiments"
              disabled={busy}
              onClick={handleApprove}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Approve
            </GatedButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={rollbackId != null}
        onOpenChange={(open) => {
          if (!open) setRollbackId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rollback experiment?</DialogTitle>
            <DialogDescription>
              This will stop the experiment and restore the exact control/default
              behavior.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {summarizeBehavior(rollbackDetail?.control_behavior ?? null)}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRollbackId(null)}>
              Cancel
            </Button>
            <GatedButton
              canAct={canAct}
              gateReason="roll back experiments"
              disabled={busy}
              onClick={handleRollback}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Rollback
            </GatedButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ExperimentDetailPanel({ experiment }: { experiment: ExperimentDetail }) {
  const row = experiment.experiment
  const evaluation = row.evaluation
  const lift = formatImprovement(evaluation?.observedImprovement ?? null)
  return (
    <div className="space-y-4">
      {row.status === 'evaluating' && (
        <Alert>
          <AlertTitle>Evaluating</AlertTitle>
          <AlertDescription>{EVALUATING_COPY}</AlertDescription>
        </Alert>
      )}
      {hasCandidate(row) && (
        <Alert>
          <AlertTitle>{CANDIDATE_COPY}</AlertTitle>
          <AlertDescription>{CAUSAL_DISCLAIMER}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <ArmCard title="Control" metrics={evaluation?.control} />
        <ArmCard title="Variant" metrics={evaluation?.variant} />
      </div>
      {lift && (
        <p className="text-sm">
          <span className="text-muted-foreground">Observed improvement: </span>
          {lift}
        </p>
      )}
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p>
          <span className="text-muted-foreground">Control behavior: </span>
          {summarizeBehavior(experiment.control_behavior)}
        </p>
        <p>
          <span className="text-muted-foreground">Variant behavior: </span>
          {summarizeBehavior(experiment.variant_behavior)}
        </p>
      </div>
    </div>
  )
}
