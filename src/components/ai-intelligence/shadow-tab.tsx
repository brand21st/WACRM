'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchObservationShadow, type ObservationShadowReport } from './api'
import {
  NO_SHADOW_COPY,
  NO_SHADOW_SUB,
  UNAVAILABLE_COPY,
} from './view-model'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

export function ShadowTab() {
  const [data, setData] = useState<ObservationShadowReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const report = await fetchObservationShadow()
        if (!cancelled) setData(report)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load shadow report')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>
  }
  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data.available) {
    return <p className="text-sm text-muted-foreground">{UNAVAILABLE_COPY}</p>
  }

  if (data.eligible_turns === 0) {
    return (
      <Card size="sm">
        <CardHeader>
          <CardTitle>Shadow retrieval</CardTitle>
          <CardDescription>
            Retrieval stays off until an admin sets Shadow in Settings. This
            report never changes customer replies.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium text-foreground">{NO_SHADOW_COPY}</p>
          <p className="mt-1 text-sm text-muted-foreground">{NO_SHADOW_SUB}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Shadow retrieval</CardTitle>
          <CardDescription>
            Observed matches from the last {data.window_days} days only. Guidance
            is not injected into customer replies.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Eligible turns" value={String(data.eligible_turns)} />
          <Metric label="Matched turns" value={String(data.matched_turns)} />
          <Metric
            label="Patterns retrieved"
            value={String(data.patterns_retrieved)}
          />
          <Metric
            label="Average match score"
            value={
              data.average_match_score == null
                ? '—'
                : String(data.average_match_score)
            }
          />
          <Metric
            label="Potentially irrelevant"
            value={String(data.potentially_irrelevant)}
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Recommendation shadow quality</CardTitle>
          <CardDescription>
            Baseline and shadow ranks use product IDs and aggregate evidence only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!data.recommendations.available ? (
            <p className="text-sm text-muted-foreground">{UNAVAILABLE_COPY}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Eligible turns"
                value={String(data.recommendations.eligible_turns)}
              />
              <Metric
                label="Baseline results"
                value={String(data.recommendations.baseline_result_count)}
              />
              <Metric
                label="Shadow results"
                value={String(data.recommendations.shadow_result_count)}
              />
              <Metric
                label="Rank agreement"
                value={
                  data.recommendations.rank_agreement == null
                    ? '—'
                    : String(data.recommendations.rank_agreement)
                }
              />
              <Metric
                label="Baseline evidence"
                value={
                  data.recommendations.evidence_coverage.baseline == null
                    ? '—'
                    : String(data.recommendations.evidence_coverage.baseline)
                }
              />
              <Metric
                label="Shadow evidence"
                value={
                  data.recommendations.evidence_coverage.shadow == null
                    ? '—'
                    : String(data.recommendations.evidence_coverage.shadow)
                }
              />
              <Metric
                label="Potentially irrelevant"
                value={String(data.recommendations.potentially_irrelevant)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Top pattern types</CardTitle>
        </CardHeader>
        <CardContent>
          {data.top_pattern_types.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NO_SHADOW_COPY}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pattern type</TableHead>
                  <TableHead className="text-right">Matches</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.top_pattern_types.map((row) => (
                  <TableRow key={row.pattern_type}>
                    <TableCell>{row.pattern_type}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Frequently matched</CardTitle>
        </CardHeader>
        <CardContent>
          {data.frequently_matched.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NO_SHADOW_COPY}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Matches</TableHead>
                  <TableHead className="text-right">Avg score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.frequently_matched.map((row) => (
                  <TableRow key={row.pattern_id}>
                    <TableCell>{row.pattern_type}</TableCell>
                    <TableCell className="text-right">{row.match_count}</TableCell>
                    <TableCell className="text-right">
                      {row.average_match_score}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Never matched</CardTitle>
        </CardHeader>
        <CardContent>
          {data.never_matched.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every active pattern has been retrieved at least once.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pattern type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.never_matched.map((row) => (
                  <TableRow key={row.pattern_id}>
                    <TableCell>{row.pattern_type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Match reasons</CardTitle>
        </CardHeader>
        <CardContent>
          {data.match_reasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{NO_SHADOW_COPY}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.match_reasons.map((row) => (
                  <TableRow key={row.reason}>
                    <TableCell>{row.reason}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
