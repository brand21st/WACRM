'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { canEditSettings } from '@/lib/auth/roles'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Row = {
  id: string
  from_phone: string | null
  conversation_id: string | null
  ai_summary: string | null
  ai_followup_draft: string | null
  ai_status: string | null
  contact?: { name?: string | null } | null
}

export function CallingAiPage() {
  const t = useTranslations('Calling')
  const { accountRole } = useAuth()
  const canEdit = accountRole ? canEditSettings(accountRole) : false
  const [enabled, setEnabled] = useState(false)
  const [autoSend, setAutoSend] = useState(false)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  const load = useCallback(async () => {
    const [settingsRes, callsRes, aiRes] = await Promise.all([
      fetch('/api/calling/settings'),
      fetch('/api/calling/calls?kind=ai'),
      fetch('/api/ai/config'),
    ])
    const settingsJson = await settingsRes.json()
    const callsJson = await callsRes.json()
    const aiJson = await aiRes.json()
    if (settingsRes.ok) {
      setEnabled(Boolean(settingsJson.settings?.ai_enabled))
      setAutoSend(Boolean(settingsJson.settings?.ai_auto_send_followup))
    }
    if (callsRes.ok) setRows(callsJson.calls ?? [])
    setConfigured(Boolean(aiJson?.configured))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    const res = await fetch('/api/calling/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ai_enabled: enabled, ai_auto_send_followup: autoSend }),
    })
    if (!res.ok) toast.error(t('saveFailed'))
    else toast.success(t('saved'))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('aiTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('aiDesc')}</p>
      </div>

      {configured === false && (
        <Card>
          <CardHeader>
            <CardTitle>{t('aiNeedsConfig')}</CardTitle>
            <CardDescription>
              <Link href="/agents" className="text-primary underline-offset-4 hover:underline">
                {t('openChatAgent')}
              </Link>
              {' · '}
              <Link href="/agents/voice" className="text-primary underline-offset-4 hover:underline">
                {t('openVoiceAgent')}
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('comingSoonTitle')}</CardTitle>
          <CardDescription>{t('liveAiBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/calling/live-ai"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('liveAiTitle')}
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t('aiEnable')}</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t('aiAutoSend')}</span>
              <Switch checked={autoSend} onCheckedChange={setAutoSend} disabled={!canEdit} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('aiAutoSendHint')}</p>
          </div>
          {canEdit && <Button onClick={() => void save()}>{t('save')}</Button>}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('noAi')}</p>
        )}
        {rows.map((row) => (
          <Card key={row.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {row.contact?.name || row.from_phone || t('contact')}
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
            <CardContent className="space-y-2 text-sm">
              <p className="text-xs text-muted-foreground">{row.ai_status}</p>
              {row.ai_summary && (
                <div>
                  <p className="font-medium">{t('summary')}</p>
                  <p className="whitespace-pre-wrap">{row.ai_summary}</p>
                </div>
              )}
              {row.ai_followup_draft && (
                <div>
                  <p className="font-medium">{t('followup')}</p>
                  <p className="whitespace-pre-wrap">{row.ai_followup_draft}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
