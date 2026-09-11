'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { fetchQueueOperations, type QueueOperationsHealth } from './api';

export function OperationsTab() {
  const [data, setData] = useState<QueueOperationsHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchQueueOperations()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Unable to load');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data && !error) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!data) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Learning workers</CardTitle>
          <CardDescription>
            Payload-free deployment health. Customer messages and job payloads
            are never shown.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.worker_heartbeats.length === 0 ? (
            <span className="text-muted-foreground text-sm">
              No current worker heartbeat
            </span>
          ) : (
            data.worker_heartbeats.map((heartbeat, index) => (
              <Badge
                key={`${heartbeat.group}-${index}`}
                variant={heartbeat.healthy ? 'secondary' : 'destructive'}
              >
                {heartbeat.group}: {heartbeat.healthy ? 'healthy' : 'stale'} (
                {heartbeat.age_seconds}s)
              </Badge>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.queues.map((queue) => (
          <Card key={queue.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{queue.name}</CardTitle>
              <CardDescription>{queue.group}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-xs">
              {['waiting', 'active', 'delayed', 'failed'].map((state) => (
                <div key={state} className="border-border rounded border p-2">
                  <p className="text-muted-foreground">{state}</p>
                  <p className="text-base font-semibold">
                    {queue.counts[state] ?? 0}
                  </p>
                  <p className="text-muted-foreground">
                    oldest {queue.oldest_age_seconds[state] ?? '—'}s
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
