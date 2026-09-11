'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SalesPatternAdminRow } from '@/lib/ai/intelligence/ai-intelligence-admin'
import { fetchPatterns } from './api'
import {
  NO_PATTERNS_COPY,
  NO_PATTERNS_SUB,
  STATUS_LABELS,
  UNAVAILABLE_COPY,
  formatConfidence,
  formatWhen,
  observedEffectiveness,
  summarizeContext,
} from './view-model'

function eligibleLabel(value: boolean | null): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return '—'
}

function PatternFacts({ pattern }: { pattern: SalesPatternAdminRow }) {
  const rate = observedEffectiveness(pattern.effectiveness)
  const evidence =
    pattern.evidence && typeof pattern.evidence === 'object'
      ? (pattern.evidence as Record<string, unknown>)
      : null
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="text-xs text-muted-foreground">Pattern type</dt>
        <dd className="font-medium">{pattern.pattern_type}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Trigger</dt>
        <dd>{pattern.trigger_event_type}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Context</dt>
        <dd>{summarizeContext(pattern.context)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Recommended behavior</dt>
        <dd className="whitespace-pre-wrap">{pattern.recommended_behavior}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Evidence</dt>
        <dd>
          {pattern.sample_count} samples · {pattern.eligible_outcome_count} eligible
          outcomes
          {evidence && Object.keys(evidence).length > 0
            ? ` · ${Object.keys(evidence).length} evidence fields`
            : ''}
        </dd>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">Success</dt>
          <dd>{pattern.success_count}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Failure</dt>
          <dd>{pattern.failure_count}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Unresolved</dt>
          <dd>{pattern.unresolved_count}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Discovery confidence</dt>
          <dd>{formatConfidence(pattern.confidence)}</dd>
        </div>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Observed effectiveness</dt>
        <dd>{rate ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Retrieval eligible</dt>
        <dd>{eligibleLabel(pattern.retrieval_eligible)}</dd>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted-foreground">Last observed</dt>
          <dd>{formatWhen(pattern.last_observed_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last evaluated</dt>
          <dd>{formatWhen(pattern.last_evaluated_at)}</dd>
        </div>
      </div>
    </dl>
  )
}

export function PatternsTab() {
  const [available, setAvailable] = useState(true)
  const [patterns, setPatterns] = useState<SalesPatternAdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SalesPatternAdminRow | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await fetchPatterns()
        if (cancelled) return
        setAvailable(result.available)
        setPatterns(result.patterns)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load patterns')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>
  }
  if (!available) {
    return <p className="text-sm text-muted-foreground">{UNAVAILABLE_COPY}</p>
  }
  if (patterns.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm font-medium text-foreground">{NO_PATTERNS_COPY}</p>
        <p className="mt-1 text-sm text-muted-foreground">{NO_PATTERNS_SUB}</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-xl ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Context</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Retrieval eligible</TableHead>
              <TableHead>Samples</TableHead>
              <TableHead>Eligible outcomes</TableHead>
              <TableHead>Observed effectiveness</TableHead>
              <TableHead>Last observed</TableHead>
              <TableHead>Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patterns.map((pattern) => (
              <TableRow
                key={pattern.id}
                className="cursor-pointer"
                onClick={() => setSelected(pattern)}
              >
                <TableCell className="font-medium">
                  {pattern.pattern_type}
                </TableCell>
                <TableCell>{pattern.trigger_event_type}</TableCell>
                <TableCell className="max-w-48 truncate">
                  {summarizeContext(pattern.context)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {STATUS_LABELS[pattern.status] ?? pattern.status}
                  </Badge>
                </TableCell>
                <TableCell>{eligibleLabel(pattern.retrieval_eligible)}</TableCell>
                <TableCell>{pattern.sample_count}</TableCell>
                <TableCell>{pattern.eligible_outcome_count}</TableCell>
                <TableCell>
                  {observedEffectiveness(pattern.effectiveness) ?? '—'}
                </TableCell>
                <TableCell>{formatWhen(pattern.last_observed_at)}</TableCell>
                <TableCell>{formatConfidence(pattern.confidence)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Sheet
        open={selected != null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{selected?.pattern_type ?? 'Pattern'}</SheetTitle>
            <SheetDescription>
              Read-only evidence. Recommended behavior cannot be edited here.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {selected ? <PatternFacts pattern={selected} /> : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
