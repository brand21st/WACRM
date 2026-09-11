'use client';

import { useState } from 'react';
import {
  Activity,
  Brain,
  Eye,
  FlaskConical,
  LayoutDashboard,
  Loader2,
  ServerCog,
  Settings2,
  Table2,
} from 'lucide-react';
import { RequireRole } from '@/components/auth/require-role';
import { OverviewTab } from '@/components/ai-intelligence/overview-tab';
import { EventsTab } from '@/components/ai-intelligence/events-tab';
import { PatternsTab } from '@/components/ai-intelligence/patterns-tab';
import { ShadowTab } from '@/components/ai-intelligence/shadow-tab';
import { ExperimentsTab } from '@/components/ai-intelligence/experiments-tab';
import { SettingsTab } from '@/components/ai-intelligence/settings-tab';
import { OperationsTab } from '@/components/ai-intelligence/operations-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';

type Tab =
  | 'overview'
  | 'events'
  | 'patterns'
  | 'shadow'
  | 'operations'
  | 'experiments'
  | 'settings';

function PermissionEmpty() {
  const { profileLoading } = useAuth();
  if (profileLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }
  return (
    <div className="border-border bg-card rounded-xl border p-8 text-center">
      <p className="text-foreground text-sm font-medium">
        You don&apos;t have permission to view AI Intelligence.
      </p>
      <p className="text-muted-foreground mt-1 text-sm">
        Ask an admin to grant access if you need to monitor sales intelligence
        or run experiments.
      </p>
    </div>
  );
}

function IntelligencePage() {
  const { accountRole } = useAuth();
  const canAct = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('overview');
  const [createSignal, setCreateSignal] = useState(0);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Brain className="text-primary h-6 w-6" />
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          AI Intelligence
        </h1>
        <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300 uppercase">
          BETA
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        Monitor how your AI learns from your business, evaluate sales
        intelligence, and safely test improvements.
      </p>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="overview">
            <LayoutDashboard className="mr-1.5 h-4 w-4" /> Overview
          </TabsTrigger>
          <TabsTrigger value="events">
            <Activity className="mr-1.5 h-4 w-4" /> Sales Events
          </TabsTrigger>
          <TabsTrigger value="patterns">
            <Table2 className="mr-1.5 h-4 w-4" /> Sales Patterns
          </TabsTrigger>
          <TabsTrigger value="shadow">
            <Eye className="mr-1.5 h-4 w-4" /> Shadow Retrieval
          </TabsTrigger>
          <TabsTrigger value="operations">
            <ServerCog className="mr-1.5 h-4 w-4" /> Operations
          </TabsTrigger>
          <TabsTrigger value="experiments">
            <FlaskConical className="mr-1.5 h-4 w-4" /> Experiments
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings2 className="mr-1.5 h-4 w-4" /> Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab onNavigate={(destination) => setTab(destination)} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventsTab canAct={canAct} />
        </TabsContent>
        <TabsContent value="patterns" className="mt-4">
          <PatternsTab />
        </TabsContent>
        <TabsContent value="shadow" className="mt-4">
          <ShadowTab />
        </TabsContent>
        <TabsContent value="operations" className="mt-4">
          <OperationsTab />
        </TabsContent>
        <TabsContent value="experiments" className="mt-4">
          <ExperimentsTab canAct={canAct} openCreateSignal={createSignal} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab
            canAct={canAct}
            onCreateExperiment={() => {
              setCreateSignal((n) => n + 1);
              setTab('experiments');
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function AiIntelligencePage() {
  return (
    <RequireRole min="admin" fallback={<PermissionEmpty />}>
      <IntelligencePage />
    </RequireRole>
  );
}
