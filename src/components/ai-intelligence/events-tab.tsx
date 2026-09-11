'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GatedButton } from '@/components/ui/gated-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  discoverAccountPatternsNow,
  enqueueRecentAnalyze,
  fetchObservationEvents,
  fetchObservationVolume,
  previewRecentAnalyze,
  type BoundedAnalyzePreview,
  type ObservationEventsReport,
  type ObservationVolumeReport,
} from './api'
import {
  ANALYZE_RECENT_CONFIRMATION,
  ANALYZE_RECENT_HELP,
  NO_EVENTS_COPY,
  NO_EVENTS_SUB,
  UNAVAILABLE_COPY,
  formatWhen,
} from './view-model'

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  )
}

export function EventsTab({ canAct }: { canAct: boolean }) {
  const [events, setEvents] = useState<ObservationEventsReport | null>(null)
  const [volume, setVolume] = useState<ObservationVolumeReport | null>(null)
  const [preview, setPreview] = useState<BoundedAnalyzePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState('')

  async function reload() {
    const [nextEvents, nextVolume, nextPreview] = await Promise.all([
      fetchObservationEvents(),
      fetchObservationVolume(),
      previewRecentAnalyze({ windowDays: 7, maxConversations: 10 }),
    ])
    setEvents(nextEvents)
    setVolume(nextVolume)
    setPreview(nextPreview)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [nextEvents, nextVolume, nextPreview] = await Promise.all([
          fetchObservationEvents(),
          fetchObservationVolume(),
          previewRecentAnalyze({ windowDays: 7, maxConversations: 10 }),
        ])
        if (!cancelled) {
          setEvents(nextEvents)
          setVolume(nextVolume)
          setPreview(nextPreview)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load events')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onAnalyze() {
    if (confirmation !== ANALYZE_RECENT_CONFIRMATION) return
    setAnalyzing(true)
    setActionNote(null)
    try {
      const result = await enqueueRecentAnalyze({
        confirmation: ANALYZE_RECENT_CONFIRMATION,
        windowDays: 7,
        maxConversations: 10,
      })
      if (result.queue_unavailable) {
        setActionNote(
          'The analyze queue is not available. Customer replies are unchanged. Learning will wait until the worker is running.',
        )
      } else {
        setActionNote(
          `Queued ${result.queued} of ${result.considered} conversations in a ${result.window_days}-day / ${result.max_conversations}-conversation batch. Replies stay unchanged.`,
        )
        setConfirmation('')
      }
      await reload()
    } catch (err) {
      setActionNote(err instanceof Error ? err.message : 'Analyze failed')
    } finally {
      setAnalyzing(false)
    }
  }

  async function onDiscover() {
    setDiscovering(true)
    setActionNote(null)
    try {
      const result = await discoverAccountPatternsNow()
      if (result.skipped) {
        setActionNote(
          result.reason === 'no_events'
            ? 'No sales events yet for this account. Analyze recent conversations first.'
            : 'Discovery skipped.',
        )
      } else {
        setActionNote(
          `Updated ${result.wrote} patterns for this account. Customer replies stay unchanged.`,
        )
      }
      await reload()
    } catch (err) {
      setActionNote(err instanceof Error ? err.message : 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>
  }
  if (!events || !volume) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Conversation volume</CardTitle>
          <CardDescription>
            Last {volume.window_days} days are the recommended analyze window.
            Customer replies are not changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Conversations"
            value={
              volume.available ? String(volume.conversation_count) : UNAVAILABLE_COPY
            }
          />
          <Metric
            label="Messages"
            value={volume.available ? String(volume.message_count) : UNAVAILABLE_COPY}
          />
          <Metric
            label="Analyzed conversations"
            value={
              volume.available
                ? String(volume.analyzed_conversation_count)
                : UNAVAILABLE_COPY
            }
          />
          <Metric
            label="Analyzed today"
            value={
              volume.available
                ? String(volume.analyzed_today_count)
                : UNAVAILABLE_COPY
            }
          />
          <Metric
            label="Unprocessed conversations"
            value={
              volume.available
                ? String(volume.unprocessed_conversation_count)
                : UNAVAILABLE_COPY
            }
          />
          <Metric
            label="Last analyzed"
            value={
              volume.available
                ? formatWhen(volume.last_analyzed_at)
                : UNAVAILABLE_COPY
            }
          />
          <Metric
            label="Recent active"
            value={
              volume.available
                ? String(volume.recent_active_conversation_count)
                : UNAVAILABLE_COPY
            }
          />
          <Metric
            label="Estimated analyze jobs"
            value={
              volume.available
                ? String(volume.estimated_analyze_jobs)
                : UNAVAILABLE_COPY
            }
          />
          <Metric
            label="Analyze queue"
            value={
              volume.analyze_queue_configured ? 'Configured' : 'Not configured'
            }
          />
          <Metric
            label="Message range"
            value={`${formatWhen(volume.first_message_at)} – ${formatWhen(volume.last_message_at)}`}
          />
        </CardContent>
      </Card>

      {canAct ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Analyze a bounded batch</CardTitle>
            <CardDescription>{ANALYZE_RECENT_HELP}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric
                label="Eligible conversations"
                value={
                  preview?.available
                    ? String(preview.eligible_conversations)
                    : UNAVAILABLE_COPY
                }
              />
              <Metric
                label="This batch"
                value={
                  preview
                    ? `${preview.selected_conversations} of ${preview.max_conversations}`
                    : UNAVAILABLE_COPY
                }
              />
              <Metric
                label="Window"
                value={preview ? `${preview.window_days} days` : UNAVAILABLE_COPY}
              />
              <Metric
                label="Estimated LLM cost"
                value={
                  preview
                    ? preview.background_learning_mode === 'hybrid'
                      ? `$${preview.estimated_cost_usd.toFixed(4)}`
                      : '$0.0000 (deterministic)'
                    : UNAVAILABLE_COPY
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="analyze-recent-confirmation">
                Type {ANALYZE_RECENT_CONFIRMATION} to confirm
              </Label>
              <Input
                id="analyze-recent-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <GatedButton
                canAct={canAct}
                gateReason="analyze conversations"
                onClick={() => void onAnalyze()}
                disabled={
                  analyzing || confirmation !== ANALYZE_RECENT_CONFIRMATION
                }
              >
                {analyzing ? 'Queuing…' : 'Analyze bounded batch'}
              </GatedButton>
              <Button
                variant="outline"
                onClick={() => void onDiscover()}
                disabled={discovering}
              >
                {discovering ? 'Discovering…' : 'Discover patterns for this account'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {actionNote ? (
        <p className="text-sm text-muted-foreground">{actionNote}</p>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle>Sales events</CardTitle>
          <CardDescription>
            Observed event types only. No customer transcripts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!events.available ? (
            <p className="text-sm text-muted-foreground">{UNAVAILABLE_COPY}</p>
          ) : events.total === 0 ? (
            <div>
              <p className="text-sm font-medium text-foreground">{NO_EVENTS_COPY}</p>
              <p className="mt-1 text-sm text-muted-foreground">{NO_EVENTS_SUB}</p>
            </div>
          ) : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <Metric label="Total events" value={String(events.total)} />
                <Metric
                  label="First observed"
                  value={formatWhen(events.first_created_at)}
                />
                <Metric
                  label="Last observed"
                  value={formatWhen(events.last_created_at)}
                />
              </div>
              {events.truncated ? (
                <p className="mb-4 text-sm text-muted-foreground">
                  Counts may be incomplete because the aggregate function is not
                  installed yet.
                </p>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event type</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.by_type.map((row) => (
                    <TableRow key={`${row.event_type}-${row.kind}`}>
                      <TableCell>{row.event_type}</TableCell>
                      <TableCell>{row.kind}</TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
