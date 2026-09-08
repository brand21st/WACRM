'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  MessageCircleQuestion,
  Package,
  PackageX,
  Search,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { MetricCard } from '@/components/dashboard/metric-card';
import { SkeletonCard } from '@/components/dashboard/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type Range = 'today' | '7d' | '30d';

interface AnalyticsRow {
  productId: string | null;
  title: string;
  asked: number;
  shown: number;
  addedToCart: number;
  purchased: number;
  stock: number | null;
  status?: string | null;
}

interface Dashboard {
  enabled: boolean;
  overview?: {
    totalProducts: number;
    activeProducts: number;
    outOfStockProducts: number;
    productsAsked: number;
    productsAddedToCart: number;
    productsPurchased: number;
  };
  topAsked?: AnalyticsRow[];
  topAddedToCart?: AnalyticsRow[];
  topPurchased?: AnalyticsRow[];
  products?: AnalyticsRow[];
}

const PAGE_SIZE = 20;
const RANGES: Range[] = ['today', '7d', '30d'];

export function CatalogAnalytics() {
  const t = useTranslations('Catalog.analytics');
  const canEdit = useCan('edit-settings');
  const [range, setRange] = useState<Range>('7d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Dashboard>({ enabled: false });

  const load = useCallback(
    async (nextRange: Range, mode: 'full' | 'refresh' = 'full') => {
      if (mode === 'full') setLoading(true);
      else setRefreshing(true);
      try {
        const res = await fetch(`/api/catalog/analytics?range=${nextRange}`, {
          cache: 'no-store',
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || t('loadFailed'));
        setData(json);
        setPage(0);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('loadFailed'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load(range, data.enabled ? 'refresh' : 'full');
    // First paint and range changes only — do not re-fetch when `data.enabled` flips from load().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, range]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    try {
      const res = await fetch('/api/catalog/analytics/flag', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || t('flagFailed'));
      await load(range, 'full');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('flagFailed'));
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const rows = data.products ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.title.toLowerCase().includes(q));
  }, [data.products, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const overview = data.overview;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{t('flagTitle')}</p>
            {data.enabled ? (
              <Badge className="bg-primary/10 text-primary">{t('recordingOn')}</Badge>
            ) : (
              <Badge variant="outline">{t('recordingOff')}</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('flagDesc')}</p>
        </div>
        {canEdit ? (
          <Switch
            checked={data.enabled}
            disabled={saving}
            onCheckedChange={(checked) => void toggle(checked)}
            aria-label={t('flagTitle')}
          />
        ) : null}
      </div>

      {!data.enabled ? (
        <DisabledState
          canEdit={canEdit}
          saving={saving}
          onEnable={() => void toggle(true)}
          t={t}
        />
      ) : (
        <div className={cn('space-y-6', refreshing && 'opacity-80 transition-opacity')}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{t('interestSection')}</h2>
              <p className="text-sm text-muted-foreground">{t('interestHint')}</p>
            </div>
            <div className="inline-flex rounded-lg bg-muted p-[3px]">
              {RANGES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRange(item)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    range === item
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`range_${item}`)}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <LoadingGrid />
          ) : (
            <>
              <section className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">{t('catalogHealth')}</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <MetricCard
                    title={t('total')}
                    value={formatCount(overview?.totalProducts)}
                    icon={Package}
                    subtitle={t('totalHint')}
                  />
                  <MetricCard
                    title={t('active')}
                    value={formatCount(overview?.activeProducts)}
                    icon={Sparkles}
                    subtitle={t('activeHint')}
                  />
                  <MetricCard
                    title={t('outOfStock')}
                    value={formatCount(overview?.outOfStockProducts)}
                    icon={PackageX}
                    subtitle={t('outOfStockHint')}
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">{t('customerSignals')}</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <MetricCard
                    title={t('asked')}
                    value={formatCount(overview?.productsAsked)}
                    icon={MessageCircleQuestion}
                    subtitle={t('askedHint')}
                  />
                  <MetricCard
                    title={t('addedToCart')}
                    value={formatCount(overview?.productsAddedToCart)}
                    icon={ShoppingCart}
                    subtitle={t('cartHint')}
                  />
                  <MetricCard
                    title={t('purchased')}
                    value={formatCount(overview?.productsPurchased)}
                    icon={ShoppingBag}
                    subtitle={t('purchasedHint')}
                  />
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-3">
                <RankedList
                  title={t('topAsked')}
                  hint={t('topAskedHint')}
                  rows={data.topAsked ?? []}
                  metric="asked"
                  empty={t('empty')}
                />
                <RankedList
                  title={t('topCart')}
                  hint={t('topCartHint')}
                  rows={data.topAddedToCart ?? []}
                  metric="addedToCart"
                  empty={t('empty')}
                />
                <RankedList
                  title={t('topPurchased')}
                  hint={t('topPurchasedHint')}
                  rows={data.topPurchased ?? []}
                  metric="purchased"
                  empty={t('empty')}
                />
              </div>

              <Card>
                <CardHeader className="gap-3 sm:grid sm:grid-cols-[1fr_auto] sm:items-end">
                  <div>
                    <CardTitle className="text-foreground">{t('performance')}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">{t('performanceHint')}</p>
                  </div>
                  <div className="relative w-full sm:w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(0);
                      }}
                      placeholder={t('searchPerformance')}
                      className="pl-8"
                    />
                  </div>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">{t('rank')}</TableHead>
                        <TableHead>{t('colProduct')}</TableHead>
                        <TableHead className="text-right">{t('asked')}</TableHead>
                        <TableHead className="text-right">{t('shown')}</TableHead>
                        <TableHead className="text-right">{t('addedToCart')}</TableHead>
                        <TableHead className="text-right">{t('purchased')}</TableHead>
                        <TableHead className="text-right">{t('stock')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                            {filtered.length === 0 && query
                              ? t('noMatch')
                              : t('empty')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        pageRows.map((row, index) => (
                          <TableRow key={row.productId ?? `${row.title}-${index}`}>
                            <TableCell className="tabular-nums text-muted-foreground">
                              {safePage * PAGE_SIZE + index + 1}
                            </TableCell>
                            <TableCell className="max-w-[280px]">
                              {row.productId ? (
                                <Link
                                  href={`/catalog/${row.productId}`}
                                  className="truncate font-medium text-foreground hover:underline"
                                >
                                  {row.title}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">{row.title}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{row.asked}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.shown}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.addedToCart}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-medium">
                              {row.purchased}
                            </TableCell>
                            <TableCell className="text-right">
                              <StockCell stock={row.stock} t={t} />
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                  {filtered.length > 0 ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                      <p>
                        {t('showing', {
                          from: safePage * PAGE_SIZE + 1,
                          to: Math.min(filtered.length, (safePage + 1) * PAGE_SIZE),
                          total: filtered.length,
                        })}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          disabled={safePage === 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                          aria-label={t('prevPage')}
                        >
                          <ChevronLeft />
                        </Button>
                        <span className="min-w-16 text-center tabular-nums">
                          {t('pageOf', { page: safePage + 1, pages: pageCount })}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          disabled={safePage >= pageCount - 1}
                          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                          aria-label={t('nextPage')}
                        >
                          <ChevronRight />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DisabledState({
  canEdit,
  saving,
  onEnable,
  t,
}: {
  canEdit: boolean;
  saving: boolean;
  onEnable: () => void;
  t: (key: string) => string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center px-6 py-14 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <BarChart3 className="h-6 w-6" />
        </div>
        <p className="text-base font-semibold text-foreground">{t('disabledTitle')}</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{t('disabledDesc')}</p>
        {canEdit ? (
          <Button className="mt-5" onClick={onEnable} disabled={saving}>
            {t('enableCta')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={`h-${i}`} />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={`s-${i}`} />
        ))}
      </div>
    </div>
  );
}

function RankedList({
  title,
  hint,
  rows,
  metric,
  empty,
}: {
  title: string;
  hint: string;
  rows: AnalyticsRow[];
  metric: 'asked' | 'addedToCart' | 'purchased';
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row[metric]));
  return (
    <Card className="min-h-[240px]">
      <CardHeader>
        <CardTitle className="text-foreground">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ol className="space-y-3">
            {rows.slice(0, 8).map((row, index) => {
              const value = row[metric];
              const width = Math.max(8, Math.round((value / max) * 100));
              return (
                <li key={row.productId ?? `${row.title}-${index}`}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm">
                      <span className="mr-2 tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      {row.productId ? (
                        <Link
                          href={`/catalog/${row.productId}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {row.title}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{row.title}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-foreground">
                      {value}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function StockCell({
  stock,
  t,
}: {
  stock: number | null;
  t: (key: string) => string;
}) {
  if (stock == null) return <span className="text-muted-foreground">—</span>;
  if (stock <= 0) {
    return (
      <Badge variant="destructive" className="justify-self-end">
        {t('stockOut')}
      </Badge>
    );
  }
  return <span className="tabular-nums">{stock}</span>;
}

function formatCount(value: number | undefined) {
  return (value ?? 0).toLocaleString();
}
