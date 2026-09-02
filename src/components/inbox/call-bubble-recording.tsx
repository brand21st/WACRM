'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function CallBubbleRecording({ metaCallId }: { metaCallId?: string | null }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!metaCallId) return
    let cancelled = false
    const supabase = createClient()
    void (async () => {
      const { data } = await supabase
        .from('calls')
        .select('id, recording_key')
        .eq('meta_call_id', metaCallId)
        .maybeSingle()
      if (cancelled || !data?.id || !data.recording_key) return
      const res = await fetch(`/api/calling/recordings/${data.id}`)
      const json = await res.json().catch(() => ({}))
      if (!cancelled && res.ok && json.url) setUrl(json.url as string)
    })()
    return () => {
      cancelled = true
    }
  }, [metaCallId])

  if (!url) return null
  return <audio src={url} controls className="mt-2 w-full max-w-xs" />
}
