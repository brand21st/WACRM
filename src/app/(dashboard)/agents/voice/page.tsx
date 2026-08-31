'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mic } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { VoiceBuildPanel } from '@/components/agents/voice-build-panel';
import { VoiceClonePanel } from '@/components/agents/voice-clone-panel';
import { VoiceTrainPanel } from '@/components/agents/voice-train-panel';
import { useTranslations } from 'next-intl';

type VoiceTab = 'clone' | 'training' | 'build';

function isVoiceTab(value: string | null): value is VoiceTab {
  return value === 'clone' || value === 'training' || value === 'build';
}

export default function VoiceAgentPage() {
  return (
    <Suspense fallback={null}>
      <VoiceAgentPageInner />
    </Suspense>
  );
}

function VoiceAgentPageInner() {
  const t = useTranslations('Agents.voice');
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = isVoiceTab(searchParams.get('tab'))
    ? (searchParams.get('tab') as VoiceTab)
    : 'build';
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setConfigured(Boolean(data?.configured));
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setTab = useCallback(
    (next: string) => {
      if (!isVoiceTab(next)) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', next);
      router.replace(`/agents/voice?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <div>
      <div className="flex items-center gap-2">
        <Mic className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>

      {configured === false ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">{t('needSetupTitle')}</CardTitle>
            <CardDescription>{t('needSetupDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button nativeButton={false} render={<Link href="/agents" />}>{t('goToSetup')}</Button>
          </CardContent>
        </Card>
      ) : configured ? (
        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList>
            <TabsTrigger value="clone">{t('tabClone')}</TabsTrigger>
            <TabsTrigger value="training">{t('tabTraining')}</TabsTrigger>
            <TabsTrigger value="build">{t('tabBuild')}</TabsTrigger>
          </TabsList>
          <TabsContent value="clone" className="mt-4">
            <VoiceClonePanel />
          </TabsContent>
          <TabsContent value="training" className="mt-4">
            <VoiceTrainPanel />
          </TabsContent>
          <TabsContent value="build" className="mt-4">
            <VoiceBuildPanel />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
