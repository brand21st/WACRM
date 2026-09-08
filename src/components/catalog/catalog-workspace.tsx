'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Circle,
  Loader2,
  Package,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/lib/currency';
import type { CatalogListItem } from '@/lib/catalog/http';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CatalogAnalytics } from '@/components/catalog/catalog-analytics';
import {
  MetaCatalogPicker,
  selectionFromPicker,
  type MetaCatalogOption,
} from '@/components/catalog/meta-catalog-picker';

interface CatalogSetup {
  schema_ready: boolean;
  shopify_connected: boolean;
  shopify_domain: string | null;
  shopify_name: string | null;
  product_count: number;
  last_import_at: string | null;
  meta_catalog_id: string | null;
  meta_catalog_ids?: string[];
  meta_catalog_auto_sync: boolean;
  last_meta_sync_at: string | null;
  meta_item_count: number;
  whatsapp_connected: boolean;
  catalog_analytics?: boolean;
}

type StatusFilter = 'all' | 'active' | 'draft' | 'archived';

interface CatalogSetListItem {
  id: string;
  title: string;
  productCount: number;
  metaSynced: boolean;
  metaCollectionReview?: 'pending' | 'live' | null;
}

function formatWhen(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

function formatPrice(item: CatalogListItem): string {
  const currency = item.currency ?? undefined;
  if (item.priceMin == null && item.priceMax == null) return '—';
  if (
    item.priceMin != null &&
    item.priceMax != null &&
    item.priceMin !== item.priceMax
  ) {
    return `${formatCurrency(item.priceMin, currency)} – ${formatCurrency(item.priceMax, currency)}`;
  }
  return formatCurrency(item.priceMin ?? item.priceMax ?? 0, currency);
}

export function CatalogWorkspace({
  initialTab = 'products',
}: {
  initialTab?: 'products' | 'collections' | 'analytics';
}) {
  const t = useTranslations('Catalog.page');
  const canEdit = useCan('edit-settings');
  const router = useRouter();

  const [setup, setSetup] = useState<CatalogSetup | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(true);
  const [products, setProducts] = useState<CatalogListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [importing, setImporting] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [metaCatalogId, setMetaCatalogId] = useState('');
  const [metaCatalogIds, setMetaCatalogIds] = useState<string[]>([]);
  const [metaCatalogs, setMetaCatalogs] = useState<MetaCatalogOption[]>([]);
  const [metaCatalogReason, setMetaCatalogReason] = useState<string | null>(null);
  const [metaCatalogsLoading, setMetaCatalogsLoading] = useState(false);
  const [metaAutoSync, setMetaAutoSync] = useState(false);
  const [tab, setTab] = useState<'products' | 'collections' | 'analytics'>(
    initialTab,
  );
  const [sets, setSets] = useState<CatalogSetListItem[]>([]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const applySetup = useCallback((data: CatalogSetup) => {
    setSetup(data);
    const ids =
      Array.isArray(data.meta_catalog_ids) && data.meta_catalog_ids.length > 0
        ? data.meta_catalog_ids
        : data.meta_catalog_id
          ? [data.meta_catalog_id]
          : [];
    setMetaCatalogIds(ids);
    setMetaCatalogId(data.meta_catalog_id ?? ids[0] ?? '');
    setMetaAutoSync(data.meta_catalog_auto_sync);
  }, []);

  const loadSetup = useCallback(async () => {
    setSetupLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/catalog/setup', { cache: 'no-store' });
      const data = await res.json();
      if (res.status === 503 && data.code === 'CATALOG_SCHEMA_MISSING') {
        setSchemaMissing(true);
        setSetup(null);
        return;
      }
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : t('loadFailed'));
      }
      setSchemaMissing(false);
      applySetup(data as CatalogSetup);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setSetupLoading(false);
    }
  }, [applySetup, t]);

  const loadProducts = useCallback(async () => {
    setListLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (status !== 'all') params.set('status', status);
      params.set('limit', '100');
      const res = await fetch(`/api/catalog?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (res.status === 503 && data.code === 'CATALOG_SCHEMA_MISSING') {
        setSchemaMissing(true);
        setProducts([]);
        setTotal(0);
        return;
      }
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : t('loadFailed'));
      }
      setProducts(Array.isArray(data.products) ? data.products : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('loadFailed'));
    } finally {
      setListLoading(false);
    }
  }, [debouncedSearch, status, t]);

  const loadMetaCatalogs = useCallback(async () => {
    setMetaCatalogsLoading(true);
    try {
      const res = await fetch('/api/catalog/meta-catalogs', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setMetaCatalogs([]);
        setMetaCatalogReason('unavailable');
        return;
      }
      setMetaCatalogs(Array.isArray(data.catalogs) ? data.catalogs : []);
      if (Array.isArray(data.selectedIds)) setMetaCatalogIds(data.selectedIds);
      if (typeof data.primaryId === 'string') {
        setMetaCatalogId(data.primaryId);
      }
      setMetaCatalogReason(typeof data.reason === 'string' ? data.reason : null);
    } catch {
      setMetaCatalogs([]);
      setMetaCatalogReason('unavailable');
    } finally {
      setMetaCatalogsLoading(false);
    }
  }, []);

  const loadSets = useCallback(async () => {
    try {
      const res = await fetch('/api/catalog/sets', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) return;
      setSets(Array.isArray(data.sets) ? data.sets : []);
    } catch {
      setSets([]);
    }
  }, []);

  useEffect(() => {
    void loadSetup();
    void loadMetaCatalogs();
  }, [loadSetup, loadMetaCatalogs]);

  useEffect(() => {
    if (schemaMissing) return;
    void loadProducts();
    void loadSets();
  }, [loadProducts, loadSets, schemaMissing]);

  const importFromShopify = async () => {
    setImporting(true);
    try {
      const res = await fetch('/api/shopify/catalog/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : t('importFailed'));
        return;
      }
      toast.success(t('imported', { count: data.count ?? 0 }));
      await Promise.all([loadSetup(), loadProducts(), loadSets()]);
    } catch {
      toast.error(t('importFailed'));
    } finally {
      setImporting(false);
    }
  };

  const saveWhatsapp = async () => {
    setSavingMeta(true);
    try {
      const selection = selectionFromPicker({
        catalogs: metaCatalogs,
        selectedIds: metaCatalogIds,
        primaryId: metaCatalogId,
        pasteId: metaCatalogId,
      });
      const res = await fetch('/api/shopify/commerce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta_catalog_id: selection.primaryId,
          meta_catalog_ids: selection.selectedIds,
          meta_catalog_auto_sync: metaAutoSync,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          typeof data.error === 'string' ? data.error : t('whatsappSaveFailed'),
        );
        return;
      }
      toast.success(t('whatsappSaved'));
      await Promise.all([loadSetup(), loadMetaCatalogs()]);
    } catch {
      toast.error(t('whatsappSaveFailed'));
    } finally {
      setSavingMeta(false);
    }
  };

  const syncWhatsapp = async () => {
    setSyncingMeta(true);
    try {
      const res = await fetch('/api/shopify/catalog/meta-sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          typeof data.error === 'string' ? data.error : t('whatsappSyncFailed'),
        );
        return;
      }
      toast.success(t('whatsappSynced', { count: data.count ?? 0 }));
      await Promise.all([loadSetup(), loadMetaCatalogs()]);
    } catch {
      toast.error(t('whatsappSyncFailed'));
    } finally {
      setSyncingMeta(false);
    }
  };

  if (schemaMissing) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('schemaMissing')}
          </CardContent>
        </Card>
      </div>
    );
  }

  const shopifyReady = setup?.shopify_connected === true;
  const hasProducts = (setup?.product_count ?? total) > 0;
  const metaSelection = selectionFromPicker({
    catalogs: metaCatalogs,
    selectedIds: metaCatalogIds,
    primaryId: metaCatalogId,
    pasteId: metaCatalogId,
  });
  const hasMetaId = metaSelection.selectedIds.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasProducts
            ? t('subtitle', { count: setup?.product_count ?? total })
            : t('subtitleZero')}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === 'collections') {
            router.push('/catalog/collections');
            return;
          }
          if (value === 'products') {
            router.push('/catalog');
            return;
          }
          setTab('analytics');
        }}
      >
        <TabsList>
          <TabsTrigger value="products">{t('tabProducts')}</TabsTrigger>
          <TabsTrigger value="collections">{t('tabCollections')}</TabsTrigger>
          <TabsTrigger value="analytics">{t('tabAnalytics')}</TabsTrigger>
        </TabsList>
        <TabsContent value="analytics" className="mt-5">
          <CatalogAnalytics />
        </TabsContent>
        <TabsContent value="collections" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {t('collectionsTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('collectionsDesc')}
              </p>
            </div>
            <Link href="/catalog/collections/new" className={buttonVariants({ size: 'sm' })}>
              {t('createCollection')}
            </Link>
          </div>
          {sets.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Package className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="font-medium text-foreground">{t('collectionsEmpty')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('collectionsEmptyDesc')}
                  </p>
                </div>
                <Link href="/catalog/collections/new" className={buttonVariants()}>
                  {t('createCollection')}
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colCollection')}</TableHead>
                    <TableHead>{t('colCollectionProducts')}</TableHead>
                    <TableHead>{t('colWhatsapp')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sets.map((set) => (
                    <TableRow
                      key={set.id}
                      className="cursor-pointer"
                      onClick={() => {
                        router.push(`/catalog/collections/${set.id}`);
                      }}
                    >
                      <TableCell>
                        <Link
                          href={`/catalog/collections/${set.id}`}
                          className="font-medium text-foreground hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {set.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t('setProductCount', { count: set.productCount ?? 0 })}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            set.metaCollectionReview === 'live'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {set.metaCollectionReview === 'live'
                            ? t('setSynced')
                            : set.metaCollectionReview === 'pending'
                              ? t('setReviewPending')
                              : set.metaSynced
                                ? t('setSynced')
                                : t('setNotPublished')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="products" className="mt-4 space-y-6">

      {loadError ? (
        <p className="text-sm text-destructive">{loadError}</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <SetupCard
          done={shopifyReady}
          loading={setupLoading}
          title={t('stepShopifyTitle')}
          description={t('stepShopifyDesc')}
        >
          <p className="text-sm text-muted-foreground">
            {shopifyReady
              ? t('stepShopifyConnected', {
                  name: setup?.shopify_name || setup?.shopify_domain || 'Shopify',
                })
              : t('stepShopifyMissing')}
          </p>
          <Link
            href="/settings?tab=shopify"
            className={buttonVariants({
              variant: shopifyReady ? 'outline' : 'default',
              size: 'sm',
            })}
          >
            {t('openShopify')}
          </Link>
        </SetupCard>

        <SetupCard
          done={hasProducts}
          loading={setupLoading}
          title={t('stepImportTitle')}
          description={t('stepImportDesc')}
        >
          <p className="text-sm text-muted-foreground">
            {t('stepImportStatus', {
              count: setup?.product_count ?? 0,
              synced: formatWhen(setup?.last_import_at ?? null, t('neverImported')),
            })}
          </p>
          <GatedButton
            canAct={canEdit}
            gateReason="import catalog products"
            variant="secondary"
            size="sm"
            onClick={() => void importFromShopify()}
            disabled={!shopifyReady || importing}
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {shopifyReady ? t('importShopify') : t('importNeedShopify')}
          </GatedButton>
        </SetupCard>

        <SetupCard
          done={hasMetaId}
          loading={setupLoading}
          title={t('stepWhatsappTitle')}
          description={t('stepWhatsappDesc')}
        >
          <MetaCatalogPicker
            catalogs={metaCatalogs}
            selectedIds={metaCatalogIds}
            primaryId={metaCatalogId}
            reason={metaCatalogReason}
            pasteId={metaCatalogId}
            loading={setupLoading || metaCatalogsLoading}
            disabled={!canEdit}
            labels={{
              count: (count) => t('metaCatalogCount', { count }),
              empty: t('metaCatalogEmpty'),
              noWhatsApp: t('metaCatalogNoWhatsApp'),
              unavailable: (reason) => t('metaCatalogUnavailable', { reason }),
              primary: t('metaCatalogPrimary'),
              setPrimary: t('metaCatalogSetPrimary'),
              pasteToggle: t('metaCatalogPasteToggle'),
              pastePlaceholder: t('metaCatalogPlaceholder'),
              pasteHint: t('metaCatalogHint'),
            }}
            onSelectionChange={({ selectedIds, primaryId }) => {
              setMetaCatalogIds(selectedIds);
              setMetaCatalogId(primaryId);
            }}
            onPasteIdChange={(value) => {
              setMetaCatalogId(value);
              setMetaCatalogIds(value.trim() ? [value.trim()] : []);
            }}
          />
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('metaAutoSync')}</p>
              <p className="text-xs text-muted-foreground">{t('metaAutoSyncDesc')}</p>
            </div>
            <Switch
              checked={metaAutoSync}
              onCheckedChange={setMetaAutoSync}
              disabled={!canEdit}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('metaSyncStatus', {
              count: setup?.meta_item_count ?? 0,
              synced: formatWhen(setup?.last_meta_sync_at ?? null, t('neverSynced')),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <GatedButton
              canAct={canEdit}
              gateReason="save catalog settings"
              size="sm"
              onClick={() => void saveWhatsapp()}
              disabled={savingMeta}
            >
              {savingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('saveWhatsapp')}
            </GatedButton>
            <GatedButton
              canAct={canEdit}
              gateReason="sync the WhatsApp catalog"
              variant="secondary"
              size="sm"
              onClick={() => void syncWhatsapp()}
              disabled={!hasMetaId || syncingMeta}
            >
              {syncingMeta ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {hasMetaId ? t('syncWhatsapp') : t('whatsappNeedId')}
            </GatedButton>
          </div>
        </SetupCard>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold text-foreground">{t('browseTitle')}</h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/catalog/new"
              className={buttonVariants({ size: 'sm' })}
            >
              {t('addProduct')}
            </Link>
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="pl-8"
              />
            </div>
            <select
              className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">{t('statusAll')}</option>
              <option value="active">{t('statusActive')}</option>
              <option value="draft">{t('statusDraft')}</option>
              <option value="archived">{t('statusArchived')}</option>
            </select>
          </div>
        </div>

        {listLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Package className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-medium text-foreground">
                  {debouncedSearch || status !== 'all' ? t('emptySearch') : t('emptyTitle')}
                </p>
                {debouncedSearch || status !== 'all' ? null : (
                  <p className="mt-1 text-sm text-muted-foreground">{t('emptyDesc')}</p>
                )}
              </div>
              {!debouncedSearch && status === 'all' ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Link href="/catalog/new" className={buttonVariants()}>
                    {t('addProduct')}
                  </Link>
                  <GatedButton
                    canAct={canEdit}
                    gateReason="import catalog products"
                    variant="outline"
                    onClick={() => void importFromShopify()}
                    disabled={!shopifyReady || importing}
                  >
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {shopifyReady ? t('importShopify') : t('importNeedShopify')}
                  </GatedButton>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colProduct')}</TableHead>
                  <TableHead>{t('colPrice')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead>{t('colVariants')}</TableHead>
                  <TableHead>{t('colOrigin')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow
                    key={product.id}
                    className="cursor-pointer"
                    onClick={() => {
                      window.location.href = `/catalog/${product.id}`;
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={product.imageUrl}
                            alt={t('imageAlt', { title: product.title })}
                            className="h-10 w-10 rounded-md object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <Link
                            href={`/catalog/${product.id}`}
                            className="truncate font-medium text-foreground hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {product.title}
                          </Link>
                          <p className="truncate text-xs text-muted-foreground">
                            {product.handle}
                          </p>
                          {product.sets?.length ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {product.sets.map((set) => (
                                <Badge key={set.id} variant="secondary" className="font-normal">
                                  {set.title}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatPrice(product)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {product.status === 'active'
                          ? t('statusActive')
                          : product.status === 'draft'
                            ? t('statusDraft')
                            : t('statusArchived')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {product.variantCount}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {product.origin === 'shopify_import'
                          ? t('originShopify')
                          : t('originWacrm')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SetupCard({
  done,
  loading,
  title,
  description,
  children,
}: {
  done: boolean;
  loading: boolean;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : done ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground" />
          )}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
