'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { canEditSettings } from '@/lib/auth/roles'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type Row = {
  id: string
  from_phone: string | null
  conversation_id: string | null
  transcript: string | null
  transcript_status: string | null
  contact?: { name?: string | null; phone?: string | null } | null
  contacts?: { name?: string | null; phone?: string | null } | null
}

export function CallingTranscriptionPage() {
  const t = useTranslations('Calling')
  const { accountRole } = useAuth()
  const canEdit = accountRole ? canEditSettings(accountRole) : false
  const [enabled, setEnabled] = useState(false)
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[]>([])

  const load = useCallback(async (search: string) => {
    const [settingsRes, callsRes] = await Promise.all([
      fetch('/api/calling/settings'),
      fetch(`/api/calling/calls?kind=transcript&q=${encodeURIComponent(search)}`),
    ])
    const settingsJson = await settingsRes.json()
    const callsJson = await callsRes.json()
    if (settingsRes.ok) setEnabled(Boolean(settingsJson.settings?.transcribe_enabled))
    if (callsRes.ok) setRows(callsJson.calls ?? [])
  }, [])

  useEffect(() => {
    void load('')
  }, [load])

  async function save() {
    const res = await fetch('/api/calling/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcribe_enabled: enabled }),
    })
    if (!res.ok) toast.error(t('saveFailed'))
    else toast.success(t('saved'))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('transcriptionTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('transcriptionDesc')}</p>
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span className="text-sm">{t('transcribeEnable')}</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
          {canEdit && <Button onClick={() => void save()}>{t('save')}</Button>}
        </CardContent>
      </Card>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void load(q)
        }}
        placeholder={t('search')}
        className="h-9 w-full max-w-md rounded-md border border-border bg-background px-3 text-sm"
      />
      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('noTranscripts')}</p>
        )}
        {rows.map((row) => (
          <Card key={row.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {row.contact?.name || row.contact?.phone || row.from_phone || t('contact')}
              </CardTitle>
              {row.conversation_id && (
                <Link
                  href={`/inbox?c=${row.conversation_id}`}
                  className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('openThread')}
                </Link>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">{row.transcript_status}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{row.transcript}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
