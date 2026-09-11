'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GatedButton } from '@/components/ui/gated-button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  IntelligenceApiError,
  fetchExperimentConfig,
  fetchLearningConfig,
  fetchPatternConfig,
  patchLearningConfig,
  patchOptimization,
  patchPatternConfig,
  type ExperimentConfig,
  type LearningConfig,
} from './api';
import {
  LEARNING_UNAVAILABLE_COPY,
  PERMISSION_COPY,
  RETRIEVAL_HELP,
  STATUS_LABELS,
  summarizeBehavior,
} from './view-model';

const EMPTY_EXPERIMENT: ExperimentConfig = {
  ai_behavior_optimization: 'off',
  active_behavior: null,
  live_experiment: null,
};

const EMPTY_LEARNING: LearningConfig = {
  background_learning_mode: 'off',
  background_learning_paused: false,
  background_learning_daily_conversation_limit: 100,
  background_learning_daily_token_limit: 25_000,
  recommendation_intelligence: 'off',
  available: false,
};

export function SettingsTab({
  canAct,
  onCreateExperiment,
}: {
  canAct: boolean;
  onCreateExperiment: () => void;
}) {
  const [retrieval, setRetrieval] = useState<'off' | 'shadow' | 'on'>('off');
  const [config, setConfig] = useState<ExperimentConfig | null>(null);
  const [learning, setLearning] = useState<LearningConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingRetrieval, setSavingRetrieval] = useState(false);
  const [savingOpt, setSavingOpt] = useState(false);
  const [savingLearning, setSavingLearning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [modeResult, experimentResult, learningResult] =
          await Promise.allSettled([
            fetchPatternConfig(),
            fetchExperimentConfig(),
            fetchLearningConfig(),
          ]);
        if (cancelled) return;
        if (modeResult.status === 'fulfilled') {
          setRetrieval(modeResult.value);
        }
        setConfig(
          experimentResult.status === 'fulfilled'
            ? experimentResult.value
            : EMPTY_EXPERIMENT
        );
        setLearning(
          learningResult.status === 'fulfilled'
            ? learningResult.value
            : EMPTY_LEARNING
        );
        if (
          modeResult.status === 'rejected' ||
          experimentResult.status === 'rejected'
        ) {
          const failed =
            modeResult.status === 'rejected'
              ? modeResult.reason
              : experimentResult.status === 'rejected'
                ? experimentResult.reason
                : null;
          toast.error(
            failed instanceof Error ? failed.message : 'Failed to load settings'
          );
        }
      } catch (err) {
        if (!cancelled) {
          setConfig(EMPTY_EXPERIMENT);
          setLearning(EMPTY_LEARNING);
          toast.error(
            err instanceof Error ? err.message : 'Failed to load settings'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleApiError(err: unknown) {
    if (err instanceof IntelligenceApiError && err.status === 403) {
      toast.error(PERMISSION_COPY);
      return;
    }
    toast.error(
      err instanceof Error
        ? err.message
        : 'Something went wrong. Please try again.'
    );
  }

  async function changeRetrieval(next: 'off' | 'shadow' | 'on') {
    const previous = retrieval;
    setRetrieval(next);
    setSavingRetrieval(true);
    try {
      const saved = await patchPatternConfig(next);
      setRetrieval(saved);
      toast.success('Sales pattern retrieval updated');
    } catch (err) {
      setRetrieval(previous);
      handleApiError(err);
    } finally {
      setSavingRetrieval(false);
    }
  }

  async function changeOptimization(enabled: boolean) {
    const previous = config;
    setConfig((current) =>
      current
        ? { ...current, ai_behavior_optimization: enabled ? 'on' : 'off' }
        : current
    );
    setSavingOpt(true);
    try {
      const mode = await patchOptimization(enabled);
      setConfig((current) =>
        current ? { ...current, ai_behavior_optimization: mode } : current
      );
      toast.success(
        enabled
          ? 'Controlled AI optimization enabled'
          : 'Controlled AI optimization disabled'
      );
    } catch (err) {
      setConfig(previous);
      handleApiError(err);
    } finally {
      setSavingOpt(false);
    }
  }

  async function changeLearning(update: Partial<LearningConfig>) {
    const previous = learning;
    setLearning((current) => (current ? { ...current, ...update } : current));
    setSavingLearning(true);
    try {
      const saved = await patchLearningConfig(update);
      setLearning(saved);
      toast.success('Background learning settings updated');
    } catch (err) {
      setLearning(previous);
      handleApiError(err);
    } finally {
      setSavingLearning(false);
    }
  }

  if (loading || !config || !learning) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
      </div>
    );
  }

  const live = config.live_experiment;
  const learningReady = learning.available !== false;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          AI Intelligence Settings
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Flags stay off until you change them. Drafts never start themselves.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Continuous Learning</CardTitle>
          <CardDescription>
            Background-only analysis. It never waits for or changes a customer
            reply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!learningReady ? (
            <Alert>
              <AlertTitle>Not installed yet</AlertTitle>
              <AlertDescription>{LEARNING_UNAVAILABLE_COPY}</AlertDescription>
            </Alert>
          ) : null}
          <div className="space-y-1.5">
            <Label>Analysis mode</Label>
            <Select
              value={learning.background_learning_mode}
              onValueChange={(value) => {
                if (value === 'off' || value === 'deterministic') {
                  void changeLearning({ background_learning_mode: value });
                }
              }}
              disabled={!canAct || !learningReady || savingLearning}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="deterministic">
                  Deterministic only
                </SelectItem>
                <SelectItem value="hybrid" disabled>
                  Hybrid (cost approval required)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Pause processing</p>
              <p className="text-muted-foreground text-xs">
                Pending deltas remain recoverable while processing is paused.
              </p>
            </div>
            <Switch
              checked={learning.background_learning_paused}
              onCheckedChange={(checked) =>
                void changeLearning({ background_learning_paused: checked })
              }
              disabled={!canAct || !learningReady || savingLearning}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Recommendation intelligence</Label>
            <Select
              value={learning.recommendation_intelligence}
              onValueChange={(value) => {
                if (value === 'off' || value === 'shadow') {
                  void changeLearning({ recommendation_intelligence: value });
                }
              }}
              disabled={!canAct || !learningReady || savingLearning}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="shadow">Shadow only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sales Pattern Intelligence</CardTitle>
          <CardDescription>Sales Pattern Retrieval</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Retrieval mode</Label>
            <Select
              value={retrieval}
              onValueChange={(value) => {
                if (value === 'off' || value === 'shadow' || value === 'on') {
                  void changeRetrieval(value);
                }
              }}
              disabled={!canAct || savingRetrieval}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="shadow">Shadow</SelectItem>
                <SelectItem value="on" disabled>
                  On (approval required)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-muted-foreground text-sm">
            {RETRIEVAL_HELP[retrieval]}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Controlled AI Optimization</CardTitle>
          <CardDescription>
            Allows controlled A/B testing of approved AI behavior
            configurations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>BETA</AlertTitle>
            <AlertDescription>
              Only enable this when you are ready to run controlled experiments.
            </AlertDescription>
          </Alert>
          <div className="border-border flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Optimization</p>
              <p className="text-muted-foreground text-xs">
                {config.ai_behavior_optimization === 'on' ? 'On' : 'Off'}
              </p>
            </div>
            <Switch
              checked={config.ai_behavior_optimization === 'on'}
              onCheckedChange={(checked) => void changeOptimization(checked)}
              disabled={
                !canAct ||
                savingOpt ||
                config.ai_behavior_optimization === 'off'
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current behavior</CardTitle>
          <CardDescription>
            Active version and any live experiment from the backend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Active behavior</p>
            <p>
              {config.active_behavior
                ? `Version ${config.active_behavior.version} · ${summarizeBehavior(config.active_behavior.behavior)}`
                : 'Default production behavior'}
            </p>
          </div>
          {live ? (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">Live experiment</p>
              <p className="font-medium">{live.name}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {STATUS_LABELS[live.status] ?? live.status}
                </Badge>
                <span>{live.variant_allocation}% variant</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground">No active experiment</p>
              <GatedButton
                canAct={canAct}
                gateReason="create experiments"
                onClick={onCreateExperiment}
              >
                Create Experiment
              </GatedButton>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
