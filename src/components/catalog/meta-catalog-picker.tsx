'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface MetaCatalogOption {
  id: string;
  name: string;
}

export interface MetaCatalogPickerLabels {
  count: (count: number) => string;
  empty: string;
  noWhatsApp: string;
  unavailable: (reason: string) => string;
  primary: string;
  setPrimary: string;
  pasteToggle: string;
  pastePlaceholder: string;
  pasteHint: string;
}

interface MetaCatalogPickerProps {
  catalogs: MetaCatalogOption[];
  selectedIds: string[];
  primaryId: string;
  reason: string | null;
  pasteId: string;
  loading?: boolean;
  disabled?: boolean;
  labels: MetaCatalogPickerLabels;
  onSelectionChange: (next: { selectedIds: string[]; primaryId: string }) => void;
  onPasteIdChange: (value: string) => void;
}

export function MetaCatalogPicker({
  catalogs,
  selectedIds,
  primaryId,
  reason,
  pasteId,
  loading,
  disabled,
  labels,
  onSelectionChange,
  onPasteIdChange,
}: MetaCatalogPickerProps) {
  const showPaste =
    !loading && catalogs.length === 0 && reason !== 'connect_whatsapp';

  const reasonText =
    reason === 'connect_whatsapp'
      ? labels.noWhatsApp
      : reason === 'none_connected'
        ? labels.empty
        : reason
          ? labels.unavailable(reason)
          : null;

  const toggle = (id: string, checked: boolean) => {
    const next = checked
      ? [...selectedIds.filter((item) => item !== id), id]
      : selectedIds.filter((item) => item !== id);
    const nextPrimary = next.includes(primaryId) ? primaryId : (next[0] ?? '');
    onSelectionChange({ selectedIds: next, primaryId: nextPrimary });
  };

  return (
    <div className="space-y-2">
      {loading ? (
        <p className="text-sm text-muted-foreground">{labels.count(catalogs.length)}</p>
      ) : catalogs.length > 0 ? (
        <>
          <p className="text-sm font-medium">{labels.count(catalogs.length)}</p>
          <ul className="max-h-44 space-y-2 overflow-y-auto">
            {catalogs.map((catalog) => {
              const checked = selectedIds.includes(catalog.id);
              const isPrimary = checked && catalog.id === primaryId;
              return (
                <li
                  key={catalog.id}
                  className="flex items-start gap-2 rounded-md border px-2 py-1.5"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      toggle(catalog.id, value === true)
                    }
                    disabled={disabled}
                    className="mt-0.5"
                    aria-label={catalog.name}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{catalog.name}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {catalog.id}
                    </p>
                  </div>
                  {checked ? (
                    isPrimary ? (
                      <Badge variant="secondary" className="shrink-0">
                        {labels.primary}
                      </Badge>
                    ) : (
                      <button
                        type="button"
                        className={cn(
                          buttonVariants({ variant: 'ghost', size: 'sm' }),
                          'h-auto shrink-0 px-1.5 py-0 text-xs',
                        )}
                        disabled={disabled}
                        onClick={() =>
                          onSelectionChange({
                            selectedIds,
                            primaryId: catalog.id,
                          })
                        }
                      >
                        {labels.setPrimary}
                      </button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{reasonText}</p>
      )}

      {showPaste ? (
        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            {labels.pasteToggle}
          </summary>
          <div className="mt-2 space-y-2">
            <Label htmlFor="meta-catalog-paste" className="sr-only">
              {labels.pasteToggle}
            </Label>
            <Input
              id="meta-catalog-paste"
              placeholder={labels.pastePlaceholder}
              value={pasteId}
              onChange={(e) => onPasteIdChange(e.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">{labels.pasteHint}</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function selectionFromPicker(opts: {
  catalogs: MetaCatalogOption[];
  selectedIds: string[];
  primaryId: string;
  pasteId: string;
}): { selectedIds: string[]; primaryId: string } {
  if (opts.catalogs.length > 0) {
    const selectedIds = unique(opts.selectedIds);
    const primaryId = selectedIds.includes(opts.primaryId)
      ? opts.primaryId
      : (selectedIds[0] ?? '');
    return { selectedIds, primaryId };
  }
  const pasted = opts.pasteId.trim();
  return pasted
    ? { selectedIds: [pasted], primaryId: pasted }
    : { selectedIds: [], primaryId: '' };
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}
