'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import {
  buildPresetSubmitPayload,
  canEnableShopifyTemplate,
  canQuickEditShopifyTemplate,
  findPresetTemplate,
  isPresetNameForTrigger,
  presetForTrigger,
  templatesForTriggerDropdown,
  type ShopifyPickerTemplate,
} from '@/lib/shopify/notification-templates';
import {
  DEFAULT_DAYS_AFTER,
  DEFAULT_DELAY_HOURS,
  DEFAULT_VARIABLE_MAPS,
  mergeRules,
  SHOPIFY_NOTIFICATION_FIELDS,
  SHOPIFY_NOTIFICATION_TRIGGERS,
  type ShopifyNotificationRule,
  type ShopifyNotificationTrigger,
  type ShopifyVariableMap,
} from '@/lib/shopify/notification-triggers';

function templateKey(name: string, language: string) {
  return `${name}::${language}`;
}

export function ShopifyNotificationsCard({
  configured,
  disabled,
}: {
  configured: boolean;
  disabled: boolean;
}) {
  const t = useTranslations('Settings.shopifyNotifications');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rules, setRules] = useState<ShopifyNotificationRule[]>(() => mergeRules([]));
  const [templates, setTemplates] = useState<ShopifyPickerTemplate[]>([]);
  const [openMap, setOpenMap] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [quickTrigger, setQuickTrigger] = useState<ShopifyNotificationTrigger | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shopify/notifications', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('loadFailed'));
        return;
      }
      if (data.warning) toast.warning(data.warning);
      setRules(mergeRules(data.rules ?? []));
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (configured) void load();
  }, [configured, load]);

  const patchRule = (
    trigger: ShopifyNotificationRule['trigger_key'],
    patch: Partial<ShopifyNotificationRule>,
  ) => {
    setRules((prev) =>
      prev.map((rule) => (rule.trigger_key === trigger ? { ...rule, ...patch } : rule)),
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/shopify/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        return;
      }
      if (Array.isArray(data.rules)) setRules(mergeRules(data.rules));
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!configured) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('loading')}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t('hint')}</p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={showAll}
                onCheckedChange={(checked) => setShowAll(checked === true)}
                disabled={disabled}
              />
              {t('showAll')}
            </label>
            {SHOPIFY_NOTIFICATION_TRIGGERS.map((key) => {
              const rule = rules.find((r) => r.trigger_key === key);
              if (!rule) return null;
              return (
                <TriggerRow
                  key={key}
                  rule={rule}
                  templates={templates}
                  showAll={showAll}
                  disabled={disabled}
                  expanded={openMap === key}
                  onToggleMap={() => setOpenMap((cur) => (cur === key ? null : key))}
                  onChange={(patch) => patchRule(key, patch)}
                  onQuick={() => setQuickTrigger(key)}
                  t={t}
                />
              );
            })}
            <Button onClick={() => void save()} disabled={disabled || saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('save')}
            </Button>
          </>
        )}
      </CardContent>
      <QuickTemplateDialog
        trigger={quickTrigger}
        templates={templates}
        disabled={disabled}
        onOpenChange={(open) => {
          if (!open) setQuickTrigger(null);
        }}
        onApplied={async (trigger, template) => {
          try {
            const res = await fetch('/api/shopify/notifications', { cache: 'no-store' });
            const data = await res.json();
            if (res.ok && Array.isArray(data.templates)) {
              setTemplates(data.templates);
            }
          } catch {
            toast.error(t('loadFailed'));
          }
          const patch: Partial<ShopifyNotificationRule> = {
            template_name: template.name,
            template_language: template.language || 'en_US',
            variable_map: { ...DEFAULT_VARIABLE_MAPS[trigger] },
          };
          if (!canEnableShopifyTemplate(template.status)) {
            patch.is_enabled = false;
          }
          patchRule(trigger, patch);
        }}
        t={t}
      />
    </Card>
  );
}

function TriggerRow({
  rule,
  templates,
  showAll,
  disabled,
  expanded,
  onToggleMap,
  onChange,
  onQuick,
  t,
}: {
  rule: ShopifyNotificationRule;
  templates: ShopifyPickerTemplate[];
  showAll: boolean;
  disabled: boolean;
  expanded: boolean;
  onToggleMap: () => void;
  onChange: (patch: Partial<ShopifyNotificationRule>) => void;
  onQuick: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const selected = templates.find(
    (row) =>
      row.name === rule.template_name && row.language === rule.template_language,
  );
  const presetRow = findPresetTemplate(templates, rule.trigger_key, rule.template_language);
  const pickerTemplates = templatesForTriggerDropdown(
    templates,
    rule.trigger_key,
    rule.template_name,
    rule.template_language,
    showAll,
  );
  const slots = useMemo(
    () => extractVariableIndices(selected?.body_text ?? ''),
    [selected?.body_text],
  );

  const quickLabel = !presetRow
    ? t('quickAdd')
    : canQuickEditShopifyTemplate(presetRow.status)
      ? t('quickEdit')
      : null;
  const waiting = presetRow?.status === 'PENDING';

  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          checked={rule.is_enabled}
          onCheckedChange={(checked) => {
            if (checked && !canEnableShopifyTemplate(selected?.status)) {
              toast.error(t('cannotEnablePending'));
              return;
            }
            onChange({ is_enabled: checked });
          }}
          disabled={disabled}
        />
        <div className="min-w-[10rem] flex-1">
          <p className="text-sm font-medium">{t(`triggers.${rule.trigger_key}`)}</p>
          <p className="text-xs text-muted-foreground">
            {t(`triggerHints.${rule.trigger_key}`)}
          </p>
        </div>
        <select
          className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
          disabled={disabled}
          value={
            rule.template_name
              ? templateKey(rule.template_name, rule.template_language)
              : ''
          }
          onChange={(e) => {
            const value = e.target.value;
            if (!value) {
              onChange({ template_name: null, template_language: 'en_US', is_enabled: false });
              return;
            }
            const [name, language] = value.split('::');
            const row = templates.find(
              (item) => item.name === name && item.language === (language || 'en_US'),
            );
            const patch: Partial<ShopifyNotificationRule> = {
              template_name: name,
              template_language: language || 'en_US',
            };
            if (isPresetNameForTrigger(name, rule.trigger_key)) {
              patch.variable_map = { ...DEFAULT_VARIABLE_MAPS[rule.trigger_key] };
            }
            if (!canEnableShopifyTemplate(row?.status)) {
              patch.is_enabled = false;
            }
            onChange(patch);
          }}
        >
          <option value="">{t('selectTemplate')}</option>
          {pickerTemplates.map((row) => {
            const approved = canEnableShopifyTemplate(row.status);
            const label = approved
              ? `${row.name} (${row.language})`
              : `${row.name} (${row.language}) · ${statusLabel(row.status, t)}`;
            return (
              <option
                key={templateKey(row.name, row.language)}
                value={templateKey(row.name, row.language)}
                disabled={!approved}
              >
                {label}
              </option>
            );
          })}
        </select>
        {waiting ? (
          <span className="text-xs text-muted-foreground">{t('waitingForMeta')}</span>
        ) : quickLabel ? (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onQuick}>
            {quickLabel}
          </Button>
        ) : null}
      </div>

      {rule.trigger_key === 'checkout_abandoned' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{t('delayHours')}</Label>
            <Input
              type="number"
              min={1}
              max={168}
              disabled={disabled}
              value={rule.config.delay_hours ?? DEFAULT_DELAY_HOURS}
              onChange={(e) =>
                onChange({
                  config: {
                    ...rule.config,
                    delay_hours: Number(e.target.value) || DEFAULT_DELAY_HOURS,
                  },
                })
              }
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('discountCode')}</Label>
            <Input
              disabled={disabled}
              value={rule.config.discount_code ?? ''}
              placeholder={t('discountPlaceholder')}
              onChange={(e) =>
                onChange({
                  config: { ...rule.config, discount_code: e.target.value },
                })
              }
            />
          </div>
        </div>
      ) : null}

      {rule.trigger_key === 'after_delivered' ? (
        <div className="space-y-1 max-w-xs">
          <Label className="text-xs">{t('daysAfter')}</Label>
          <Input
            type="number"
            min={1}
            max={90}
            disabled={disabled}
            value={rule.config.days_after ?? DEFAULT_DAYS_AFTER}
            onChange={(e) =>
              onChange({
                config: {
                  ...rule.config,
                  days_after: Number(e.target.value) || DEFAULT_DAYS_AFTER,
                },
              })
            }
          />
        </div>
      ) : null}

      {rule.template_name && slots.length > 0 ? (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onToggleMap}>
            {expanded ? t('hideVariables') : t('mapVariables')}
          </Button>
          {expanded ? (
            <div className="mt-2 space-y-2">
              {slots.map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <Label className="w-16 shrink-0 text-xs font-mono">{`{{${n}}}`}</Label>
                  <select
                    className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    disabled={disabled}
                    value={rule.variable_map[String(n)] ?? ''}
                    onChange={(e) => {
                      const next: ShopifyVariableMap = {
                        ...rule.variable_map,
                        [String(n)]: e.target.value,
                      };
                      onChange({ variable_map: next });
                    }}
                  >
                    <option value="">{t('pickField')}</option>
                    {SHOPIFY_NOTIFICATION_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {t(`fields.${field}`)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{t('urlInBodyHint')}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(
  status: string | undefined,
  t: ReturnType<typeof useTranslations>,
): string {
  if (status === 'PENDING') return t('statusPending');
  if (status === 'REJECTED') return t('statusRejected');
  if (status === 'PAUSED') return t('statusPaused');
  if (status === 'APPROVED') return t('statusApproved');
  return status ?? '';
}

function QuickTemplateDialog({
  trigger,
  templates,
  disabled,
  onOpenChange,
  onApplied,
  t,
}: {
  trigger: ShopifyNotificationTrigger | null;
  templates: ShopifyPickerTemplate[];
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied: (
    trigger: ShopifyNotificationTrigger,
    template: ShopifyPickerTemplate,
  ) => Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const preset = trigger ? presetForTrigger(trigger) : null;
  const existing = trigger
    ? findPresetTemplate(templates, trigger)
    : undefined;
  const isEdit = Boolean(existing?.id && canQuickEditShopifyTemplate(existing.status));
  const [body, setBody] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    const next = presetForTrigger(trigger);
    const row = findPresetTemplate(templates, trigger);
    setBody(row?.body_text || next.body_text);
    setNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot when the dialog opens
  }, [trigger]);

  const submit = async () => {
    if (!trigger || !preset) return;
    setSubmitting(true);
    try {
      const payload = buildPresetSubmitPayload(preset, body, notes);
      const url =
        isEdit && existing?.id
          ? `/api/whatsapp/templates/${existing.id}`
          : '/api/whatsapp/templates/submit';
      const res = await fetch(url, {
        method: isEdit && existing?.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t('submitFailed'));
      }
      const row = (data.template ?? payload) as ShopifyPickerTemplate;
      await onApplied(trigger, {
        id: row.id,
        name: row.name ?? preset.name,
        language: row.language ?? preset.language,
        category: row.category ?? preset.category,
        body_text: row.body_text ?? payload.body_text,
        status: row.status ?? 'PENDING',
      });
      toast.success(
        canEnableShopifyTemplate(row.status) ? t('submittedApproved') : t('submittedPending'),
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={trigger !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('dialogTitleEdit') : t('dialogTitleAdd')}
            {trigger ? ` — ${t(`triggers.${trigger}`)}` : ''}
          </DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        {preset ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">{t('templateName')}</Label>
                <Input value={preset.name} readOnly disabled />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('category')}</Label>
                <Input value={preset.category} readOnly disabled />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('language')}</Label>
                <Input value={preset.language} readOnly disabled />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('body')}</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={disabled || submitting}
                rows={5}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('requirements')}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={disabled || submitting}
                placeholder={t('requirementsPlaceholder')}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">{t('requirementsHint')}</p>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={disabled || submitting || !preset}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('submitToMeta')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
