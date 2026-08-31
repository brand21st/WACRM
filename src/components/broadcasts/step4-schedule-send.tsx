'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ArrowLeft, Clock, Loader2, Minus, Plus, Save, Send, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  defaultScheduleLocalValue,
  isScheduleAtLeastLead,
  joinDatetimeLocal,
  parseDatetimeLocalToIso,
  SCHEDULE_MIN_LEAD_MS,
  SCHEDULE_NUDGE_MS,
  schedulePresetLocalValue,
  scheduleRelativeParts,
  shiftDatetimeLocal,
  splitDatetimeLocal,
  toDatetimeLocalValue,
  type SchedulePresetId,
} from '@/lib/broadcast-schedule-time';

const SCHEDULE_PRESETS: { id: SchedulePresetId; labelKey: 'preset15m' | 'preset1h' | 'preset3h' | 'presetTomorrow' }[] = [
  { id: '15m', labelKey: 'preset15m' },
  { id: '1h', labelKey: 'preset1h' },
  { id: '3h', labelKey: 'preset3h' },
  { id: 'tomorrow9', labelKey: 'presetTomorrow' },
];

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
}

export type SendWhen = 'now' | 'schedule';

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  onSend: () => void;
  onSchedule: (scheduledAtIso: string) => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  onSend,
  onSchedule,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [showConfirm, setShowConfirm] = useState(false);
  const [when, setWhen] = useState<SendWhen>('now');
  const [scheduledLocal, setScheduledLocal] = useState(defaultScheduleLocalValue);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set((contactTags ?? []).map((ct) => ct.contact_id));
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : t('scheduleSend.audienceField');

  const scheduledIso = useMemo(
    () => (when === 'schedule' ? parseDatetimeLocalToIso(scheduledLocal) : null),
    [when, scheduledLocal],
  );
  const scheduleValid =
    when === 'now' || (scheduledIso !== null && isScheduleAtLeastLead(scheduledIso));
  const minLocal = toDatetimeLocalValue(new Date(Date.now() + SCHEDULE_MIN_LEAD_MS));
  const { date: scheduledDate, time: scheduledTime } = splitDatetimeLocal(scheduledLocal);
  const canNudgeEarlier =
    scheduledIso !== null &&
    isScheduleAtLeastLead(
      new Date(new Date(scheduledIso).getTime() - SCHEDULE_NUDGE_MS).toISOString(),
    );
  const scheduledDisplay = scheduledIso
    ? new Date(scheduledIso).toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : scheduledLocal;
  const relativeParts = scheduledIso ? scheduleRelativeParts(scheduledIso) : null;
  const relativeLabel = relativeParts
    ? relativeParts.unit === 'minutes'
      ? t('scheduleSend.schedulePreviewRelativeMinutes', { count: relativeParts.count })
      : relativeParts.unit === 'hours'
        ? t('scheduleSend.schedulePreviewRelativeHours', { count: relativeParts.count })
        : t('scheduleSend.schedulePreviewRelativeDays', { count: relativeParts.count })
    : null;

  function applyScheduledLocal(next: string) {
    setScheduledLocal(shiftDatetimeLocal(next, 0));
  }

  const primaryDisabled = !name.trim() || isProcessing || !scheduleValid;

  function confirmAction() {
    setShowConfirm(false);
    if (when === 'schedule') {
      if (!scheduledIso || !isScheduleAtLeastLead(scheduledIso)) return;
      onSchedule(scheduledIso);
      return;
    }
    onSend();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('scheduleSend.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('scheduleSend.broadcastName')}</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.whenLabel')}</p>
        <RadioGroup
          value={when}
          onValueChange={(value) => setWhen(value as SendWhen)}
          className="grid gap-2 sm:grid-cols-2"
          disabled={isProcessing}
        >
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
              when === 'now'
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card/50 hover:bg-muted/40',
            )}
          >
            <RadioGroupItem value="now" className="mt-0.5" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Send className="h-3.5 w-3.5" />
                {t('scheduleSend.whenNow')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('scheduleSend.whenNowDesc')}
              </p>
            </div>
          </label>
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
              when === 'schedule'
                ? 'border-primary bg-primary/5'
                : 'border-border bg-card/50 hover:bg-muted/40',
            )}
          >
            <RadioGroupItem value="schedule" className="mt-0.5" />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Clock className="h-3.5 w-3.5" />
                {t('scheduleSend.whenSchedule')}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('scheduleSend.whenScheduleDesc')}
              </p>
            </div>
          </label>
        </RadioGroup>

        {when === 'schedule' && (
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {t('scheduleSend.schedulePresets')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SCHEDULE_PRESETS.map((preset) => {
                  const active = scheduledLocal === schedulePresetLocalValue(preset.id);
                  return (
                    <Button
                      key={preset.id}
                      type="button"
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={isProcessing}
                      onClick={() => applyScheduledLocal(schedulePresetLocalValue(preset.id))}
                      className={cn(
                        'h-7',
                        !active && 'border-border bg-background text-foreground',
                      )}
                    >
                      {t(`scheduleSend.${preset.labelKey}`)}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="broadcast-schedule-date"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  {t('scheduleSend.scheduleDate')}
                </label>
                <Input
                  id="broadcast-schedule-date"
                  type="date"
                  value={scheduledDate}
                  min={minLocal.slice(0, 10)}
                  onChange={(e) =>
                    applyScheduledLocal(joinDatetimeLocal(e.target.value, scheduledTime))
                  }
                  disabled={isProcessing}
                  className="h-10 border-border bg-muted text-foreground"
                />
              </div>
              <div>
                <label
                  htmlFor="broadcast-schedule-time"
                  className="mb-1.5 block text-sm font-medium text-foreground"
                >
                  {t('scheduleSend.scheduleTime')}
                </label>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={isProcessing || !canNudgeEarlier}
                    aria-label={t('scheduleSend.nudgeEarlier')}
                    title={t('scheduleSend.nudgeEarlier')}
                    onClick={() =>
                      setScheduledLocal(shiftDatetimeLocal(scheduledLocal, -SCHEDULE_NUDGE_MS))
                    }
                    className="h-10 w-10 shrink-0 border-border"
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    id="broadcast-schedule-time"
                    type="time"
                    step={300}
                    value={scheduledTime}
                    onChange={(e) =>
                      applyScheduledLocal(joinDatetimeLocal(scheduledDate, e.target.value))
                    }
                    disabled={isProcessing}
                    className="h-10 min-w-0 flex-1 border-border bg-muted text-center text-foreground tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={isProcessing}
                    aria-label={t('scheduleSend.nudgeLater')}
                    title={t('scheduleSend.nudgeLater')}
                    onClick={() =>
                      setScheduledLocal(shiftDatetimeLocal(scheduledLocal, SCHEDULE_NUDGE_MS))
                    }
                    className="h-10 w-10 shrink-0 border-border"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {scheduleValid && scheduledIso ? (
              <p className="text-sm text-foreground">
                {t('scheduleSend.schedulePreview', { when: scheduledDisplay })}
                {relativeLabel ? (
                  <span className="text-muted-foreground"> · {relativeLabel}</span>
                ) : null}
              </p>
            ) : (
              <p className="text-xs text-red-400">{t('scheduleSend.errorPast')}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('scheduleSend.scheduleAtHint')}</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.estimatedReach')}</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.language')}</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">
                {when === 'schedule' ? t('scheduleSend.scheduling') : t('scheduleSend.sending')}
              </p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={
              <Button
                disabled={primaryDisabled}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              />
            }
          >
            {when === 'schedule' ? (
              <Clock className="h-4 w-4" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {when === 'schedule' ? t('scheduleSend.scheduleNow') : t('scheduleSend.sendNow')}
          </DialogTrigger>
          <DialogContent className="border-border bg-popover sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">
                {when === 'schedule'
                  ? t('scheduleSend.confirmScheduleTitle')
                  : t('scheduleSend.confirmSendTitle')}
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {when === 'schedule'
                  ? t('scheduleSend.confirmScheduleDesc', {
                      count: estimatedReach.toLocaleString(),
                      template: template.name,
                      when: scheduledDisplay,
                    })
                  : t('scheduleSend.confirmSendDesc', {
                      count: estimatedReach.toLocaleString(),
                      template: template.name,
                    })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-border text-muted-foreground"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={confirmAction}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {when === 'schedule' ? (
                  <Clock className="h-4 w-4" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {when === 'schedule' ? t('scheduleSend.scheduleNow') : t('scheduleSend.sendNow')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
