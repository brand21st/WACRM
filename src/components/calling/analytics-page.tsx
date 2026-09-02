'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Phone } from 'lucide-react'
import { BarChart } from '@/components/tremor/bar-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatCallDuration } from '@/lib/calls/preview'

type AnalyticsResponse = {
  calling_status: 'enabled' | 'disabled'
  totals: {
    volume: number
    answered: number
    missed: number
    rejected: number
    failed: number
    avgDurationSeconds: number
    totalDurationSeconds: number
  }
  daily: { date: string; calls: number }[]
  byAgent: { userId: string | null; name: string; answered: number; durationSeconds: number }[]
  recent: {
    id: string
    status: string
    duration: string
    recorded: boolean
    createdAt: string
    contact: string | null
    agent: string | null
  }[]
}

const WINDOWS = [7, 30, 90] as const

export function CallingAnalyticsPage() {
  const t = useTranslations('Calling')
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30)
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (windowDays: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/calling/analytics?days=${windowDays}`)
      const json = (await res.json()) as AnalyticsResponse
      if (res.ok) setData(json)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(days)
  }, [days, load])

  const totals = data?.totals

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Phone className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t('analyticsTitle')}
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('analyticsDesc')}</p>
        </div>
        <Select
          value={String(days)}
          onValueChange={(v) => setDays(Number(v) as (typeof WINDOWS)[number])}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WINDOWS.map((w) => (
              <SelectItem key={w} value={String(w)}>
                {t('windowDays', { days: w })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data?.calling_status === 'disabled' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm">
          <p className="text-muted-foreground">{t('callingDisabled')}</p>
          <Link
            href="/calling/settings"
            className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground"
          >
            {t('openSettings')}
          </Link>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={t('volume')} value={totals?.volume} loading={loading} />
        <Metric label={t('answered')} value={totals?.answered} loading={loading} />
        <Metric label={t('missed')} value={totals?.missed} loading={loading} />
        <Metric label={t('rejected')} value={totals?.rejected} loading={loading} />
        <Metric label={t('failed')} value={totals?.failed} loading={loading} />
        <Metric
          label={t('avgDuration')}
          value={totals ? formatCallDuration(totals.avgDurationSeconds) : '—'}
          loading={loading}
        />
        <Metric
          label={t('totalDuration')}
          value={totals ? formatCallDuration(totals.totalDurationSeconds) : '—'}
          loading={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('calls')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.daily?.length ? (
            <BarChart
              data={data.daily}
              index="date"
              categories={['calls']}
              className="h-56"
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('noCalls')}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('byAgent')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.byAgent?.length ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 font-medium">{t('agent')}</th>
                    <th className="pb-2 font-medium">{t('answered')}</th>
                    <th className="pb-2 font-medium">{t('duration')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byAgent.map((row) => (
                    <tr key={row.userId ?? row.name} className="border-t border-border">
                      <td className="py-2">{row.name}</td>
                      <td>{row.answered}</td>
                      <td>{formatCallDuration(row.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noCalls')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">{t('recent')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.recent?.length ? (
              <ul className="space-y-2 text-sm">
                {data.recent.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-2 border-b border-border pb-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.contact || t('contact')}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.status}
                        {row.recorded ? ` · ${t('recorded')}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-muted-foreground">{row.duration}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noCalls')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  loading,
}: {
  label: string
  value: number | string | undefined
  loading: boolean
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-foreground">
          {loading ? '…' : (value ?? 0)}
        </p>
      </CardContent>
    </Card>
  )
}
