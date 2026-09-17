'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent } from 'react';
import { toast } from 'sonner';
import {
  BookOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { extractHttpUrl } from '@/lib/ai/scrape-url';
import { SHOPIFY_PRODUCT_KB_PREFIX } from '@/lib/shopify/product-knowledge-prefix';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';

interface DocSummary {
  id: string;
  title: string;
  updated_at: string;
  source_type?: 'manual' | 'url';
  source_url?: string | null;
  last_scraped_at?: string | null;
  scrape_error?: string | null;
}

interface StoreVariant {
  title: string;
  price?: string | null;
  available?: boolean;
  sku?: string | null;
}

interface StoreItem {
  id: string;
  kind: 'policy' | 'page' | 'product';
  title: string;
  handle?: string | null;
  page_url?: string | null;
  image_url?: string | null;
  body?: string | null;
  price_min?: string | null;
  price_max?: string | null;
  currency?: string | null;
  variants?: StoreVariant[];
}

interface ScrapeJob {
  id: string;
  start_url: string;
  current_url?: string;
  mode: 'page' | 'site';
  status: 'queued' | 'running' | 'done' | 'failed';
  pages_found: number;
  pages_saved: number;
  pages_failed: number;
  error: string | null;
}

type EditTarget = 'new' | string | null;

export function KnowledgeBasePanel() {
  const { accountId, accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.knowledgeBase');
  const tk = useTranslations('Settings.aiKnowledge');

  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [job, setJob] = useState<ScrapeJob | null>(null);
  const [scraping, setScraping] = useState(false);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [hasEmbeddingsKey, setHasEmbeddingsKey] = useState(false);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifySyncing, setShopifySyncing] = useState(false);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [storeProducts, setStoreProducts] = useState<StoreItem[]>([]);
  const lastStartedRef = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);
  const shopifyAutoRef = useRef(false);

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/knowledge');
      const data = await res.json();
      if (res.ok) setDocs(data.documents ?? []);
      else toast.error(data.error ?? tk('loadFailed'));
    } catch {
      toast.error(tk('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [tk]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchDocs();
  }, [accountId, fetchDocs]);

  const fetchStoreItems = useCallback(async () => {
    try {
      const res = await fetch('/api/shopify/content/sync');
      const data = await res.json();
      if (res.ok) {
        setStoreItems(Array.isArray(data.items) ? data.items : []);
        setStoreProducts(
          Array.isArray(data.products)
            ? data.products.map((row: StoreItem) => ({ ...row, kind: 'product' as const }))
            : [],
        );
      }
    } catch {
      /* list is optional */
    }
  }, []);

  const syncShopify = useCallback(
    async (opts?: { silent?: boolean }) => {
      setShopifySyncing(true);
      try {
        const res = await fetch('/api/shopify/catalog/sync', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
          if (!opts?.silent) {
            toast.success(
              t('shopifySynced', {
                count: (data.count ?? 0) + (data.content_count ?? 0),
              }),
            );
          }
          await Promise.all([fetchStoreItems(), fetchDocs()]);
        } else if (!opts?.silent) {
          toast.error(data.error ?? t('shopifySyncFailed'));
        }
      } catch {
        if (!opts?.silent) toast.error(t('shopifySyncFailed'));
      } finally {
        setShopifySyncing(false);
      }
    },
    [fetchDocs, fetchStoreItems, t],
  );

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/ai/config')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setHasEmbeddingsKey(Boolean(data.has_embeddings_key));
      })
      .catch(() => undefined);
    void fetch('/api/shopify/config')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const connected = Boolean(data.configured) && data.is_active !== false;
        setShopifyConnected(connected);
        if (!connected) return;
        const neverSynced =
          !data.last_content_sync_at ||
          !Number(data.content_item_count) ||
          !data.last_catalog_sync_at ||
          !Number(data.catalog_product_count);
        if (neverSynced && canEdit && !shopifyAutoRef.current) {
          shopifyAutoRef.current = true;
          void syncShopify({ silent: true });
        } else {
          void fetchStoreItems();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canEdit, fetchStoreItems, syncShopify]);

  const pollJob = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/ai/knowledge/scrape/${id}`);
      const data = await res.json();
      if (!res.ok || !data.job) return null;
      const next = data.job as ScrapeJob;
      setJob(next);
      if (next.status === 'done' || next.status === 'failed') {
        setScraping(false);
        lastStartedRef.current = '';
        await fetchDocs();
        if (next.status === 'failed' || next.pages_saved <= 0) {
          toast.error(next.error ?? t('scrapeFailed'));
        } else if (next.pages_failed > 0) {
          toast.success(
            t('learnedPartial', {
              saved: next.pages_saved,
              failed: next.pages_failed,
            }),
          );
        } else {
          let host = next.start_url;
          try {
            host = new URL(next.start_url).hostname;
          } catch {
            /* keep raw */
          }
          toast.success(t('learned', { saved: next.pages_saved, host }));
        }
      }
      return next;
    },
    [fetchDocs, t],
  );

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    const timer = setInterval(() => {
      void pollJob(job.id);
    }, 1500);
    return () => clearInterval(timer);
  }, [job, pollJob]);

  const startScrape = useCallback(
    async (raw: string) => {
      if (!canEdit) return;
      const extracted = extractHttpUrl(raw);
      if (!extracted) return;
      let canonical = extracted;
      try {
        const parsed = new URL(extracted);
        canonical = parsed.href;
      } catch {
        toast.error(t('invalidUrl'));
        return;
      }
      if (scraping && lastStartedRef.current === canonical) return;
      if (scraping) {
        toast.error(t('alreadyRunning'));
        return;
      }
      lastStartedRef.current = canonical;
      setUrl(extracted);
      setScraping(true);
      setJob(null);
      try {
        const res = await fetch('/api/ai/knowledge/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: extracted }),
        });
        const data = await res.json();
        if (res.status === 409 && data.job) {
          setJob(data.job);
          toast.error(t('alreadyRunning'));
          return;
        }
        if (!res.ok) {
          setScraping(false);
          lastStartedRef.current = '';
          toast.error(data.error ?? t('scrapeFailed'));
          return;
        }
        const next = data.job as ScrapeJob;
        setJob(next);
        if (next.status === 'done' || next.status === 'failed') {
          setScraping(false);
          lastStartedRef.current = '';
          await fetchDocs();
          if (next.status === 'failed' || next.pages_saved <= 0) {
            toast.error(next.error ?? t('scrapeFailed'));
          } else {
            let host = next.start_url;
            try {
              host = new URL(next.start_url).hostname;
            } catch {
              /* keep raw */
            }
            toast.success(t('learned', { saved: next.pages_saved, host }));
          }
        }
      } catch {
        setScraping(false);
        lastStartedRef.current = '';
        toast.error(t('scrapeFailed'));
      }
    },
    [canEdit, fetchDocs, scraping, t],
  );

  const onUrlChange = (value: string) => {
    setUrl(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (extractHttpUrl(value)) void startScrape(value);
    }, 400);
  };

  const onUrlPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (extractHttpUrl(pasted)) {
      event.preventDefault();
      setUrl(pasted.trim());
      void startScrape(pasted);
    }
  };

  const openNew = () => {
    setEditing('new');
    setTitle('');
    setContent('');
  };

  const openEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? tk('openFailed'));
        return;
      }
      setEditing(id);
      setTitle(data.title ?? '');
      setContent(data.content ?? '');
    } catch {
      toast.error(tk('openFailed'));
    }
  };

  const cancelEdit = () => {
    setEditing(null);
    setTitle('');
    setContent('');
  };

  const save = async () => {
    if (editing === 'new') {
      const titleUrl = extractHttpUrl(title);
      const contentUrl = extractHttpUrl(content);
      const titleIsUrl = Boolean(titleUrl && title.trim() === titleUrl);
      const contentIsUrl = Boolean(contentUrl && content.trim() === contentUrl);
      const titleEmpty = !title.trim();
      const contentEmpty = !content.trim();
      if ((titleIsUrl && contentEmpty) || (contentIsUrl && titleEmpty)) {
        cancelEdit();
        void startScrape((titleUrl ?? contentUrl) as string);
        return;
      }
    }
    if (!title.trim() || !content.trim()) {
      toast.error(tk('titleContentRequired'));
      return;
    }
    setSaving(true);
    try {
      const isNew = editing === 'new';
      const res = await fetch(
        isNew ? '/api/ai/knowledge' : `/api/ai/knowledge/${editing}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), content: content.trim() }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        if (data.warning) toast.warning(data.warning);
        else toast.success(isNew ? tk('saveSuccessNew') : tk('saveSuccessUpdate'));
        cancelEdit();
        await fetchDocs();
      } else {
        toast.error(data.error ?? tk('saveFailed'));
      }
    } catch {
      toast.error(tk('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success(tk('removeSuccess'));
        setDocs((d) => d.filter((x) => x.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error ?? tk('removeFailed'));
      }
    } catch {
      toast.error(tk('removeFailed'));
    }
  };

  const reindex = async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/ai/knowledge/reindex', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(tk('reindexSuccess', { count: data.reindexed }));
      } else {
        toast.error(data.error ?? tk('reindexFailed'));
      }
    } catch {
      toast.error(tk('reindexFailed'));
    } finally {
      setReindexing(false);
    }
  };

  const learningUrl = job?.current_url || url || job?.start_url || '…';
  const productDocs = docs.filter((doc) =>
    (doc.title ?? '').startsWith(SHOPIFY_PRODUCT_KB_PREFIX),
  );
  const manualDocs = docs.filter((doc) => {
    const title = doc.title ?? '';
    return (
      !title.startsWith(SHOPIFY_PRODUCT_KB_PREFIX) && !title.startsWith('[Shopify] ')
    );
  });
  const products: StoreItem[] =
    storeProducts.length > 0
      ? storeProducts
      : productDocs.map((doc) => ({
          id: doc.id,
          title: doc.title.slice(SHOPIFY_PRODUCT_KB_PREFIX.length) || doc.title,
          page_url: doc.source_url ?? null,
          kind: 'product' as const,
        }));
  const policies = storeItems.filter((item) => item.kind === 'policy');
  const pages = storeItems.filter((item) => item.kind === 'page');

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-primary" /> {t('pasteLabel')}
            </CardTitle>
            <CardDescription>{t('pasteHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              onPaste={onUrlPaste}
              onBlur={() => {
                if (extractHttpUrl(url)) void startScrape(url);
              }}
              placeholder={t('pastePlaceholder')}
              disabled={!canEdit || scraping}
              inputMode="url"
            />
            {scraping || job?.status === 'running' || job?.status === 'queued' ? (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                <span className="min-w-0 break-all">
                  {t('learning', { url: learningUrl })}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>

        {shopifyConnected && canEdit ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBag className="h-4 w-4 text-primary" /> {t('shopifyTitle')}
              </CardTitle>
              <CardDescription>{t('shopifyDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void syncShopify()}
                disabled={shopifySyncing}
              >
                {shopifySyncing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t('shopifySync')}
              </Button>
              {policies.length + pages.length + products.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {t('shopifyIndexed', {
                      policies: policies.length,
                      pages: pages.length,
                      products: products.length,
                    })}
                  </p>
                  <ShopifyGroup
                    title={t('shopifyGroupPolicies', { count: policies.length })}
                    items={policies}
                    emptyBody={t('shopifyEmptyBody')}
                    kindLabel={t('shopifyKindPolicy')}
                  />
                  <ShopifyGroup
                    title={t('shopifyGroupPages', { count: pages.length })}
                    items={pages}
                    emptyBody={t('shopifyEmptyBody')}
                    kindLabel={t('shopifyKindPage')}
                  />
                  <ShopifyGroup
                    title={t('shopifyGroupProducts', { count: products.length })}
                    items={products}
                    emptyBody={t('shopifyEmptyBody')}
                    kindLabel={t('shopifyKindProduct')}
                    showPrice
                    defaultOpen
                    collapseLabel={t('shopifyCollapse')}
                    expandLabel={t('shopifyExpand')}
                    inStockLabel={t('shopifyInStock')}
                    outOfStockLabel={t('shopifyOutOfStock')}
                    variantsLabel={t('shopifyVariants')}
                  />
                </div>
              ) : shopifySyncing ? null : (
                <p className="text-sm text-muted-foreground">{t('shopifyItemsEmpty')}</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="h-4 w-4 text-primary" /> {t('documentsTitle')}
            </CardTitle>
            <CardDescription>
              {t('documentsDesc', {
                searchType: hasEmbeddingsKey
                  ? tk('semanticSearchOn')
                  : tk('keywordSearchOn'),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="flex items-center py-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {tk('loading')}
              </div>
            ) : (
              <>
                {manualDocs.length === 0 && editing === null ? (
                  <p className="text-sm text-muted-foreground">{tk('noDocs')}</p>
                ) : null}

                {manualDocs.length > 0 ? (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {manualDocs.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-foreground">
                            {doc.title}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2">
                            <Badge variant="secondary">
                              {doc.source_type === 'url' ? t('sourceUrl') : t('sourceManual')}
                            </Badge>
                            {doc.source_url ? (
                              <a
                                href={doc.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                                title={t('openSource')}
                              >
                                <ExternalLink className="h-3 w-3" />
                                {safeHost(doc.source_url)}
                              </a>
                            ) : null}
                            {doc.scrape_error ? (
                              <span className="block truncate text-xs text-destructive">
                                {doc.scrape_error}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        {canEdit ? (
                          <span className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => void openEdit(doc.id)}
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              onClick={() => void remove(doc.id)}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {editing !== null ? (
                  <div className="space-y-3 rounded-md border border-border p-3">
                    <div className="space-y-2">
                      <Label htmlFor="kb-title">{tk('editDocTitle')}</Label>
                      <Input
                        id="kb-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onPaste={(event) => {
                          const pasted = event.clipboardData.getData('text');
                          const extracted = extractHttpUrl(pasted);
                          if (extracted && pasted.trim() === extracted) {
                            event.preventDefault();
                            cancelEdit();
                            void startScrape(extracted);
                          }
                        }}
                        placeholder={tk('editDocTitlePlaceholder')}
                        disabled={saving}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="kb-content">{tk('editDocContent')}</Label>
                      <Textarea
                        id="kb-content"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        onPaste={(event) => {
                          const pasted = event.clipboardData.getData('text');
                          const extracted = extractHttpUrl(pasted);
                          if (extracted && pasted.trim() === extracted) {
                            event.preventDefault();
                            cancelEdit();
                            void startScrape(extracted);
                          }
                        }}
                        placeholder={tk('editDocContentPlaceholder')}
                        rows={8}
                        disabled={saving}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={cancelEdit} disabled={saving}>
                        {tk('cancel')}
                      </Button>
                      <Button onClick={() => void save()} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {tk('saveDoc')}
                      </Button>
                    </div>
                  </div>
                ) : canEdit ? (
                  <div className="flex items-center justify-between">
                    <Button variant="outline" size="sm" onClick={openNew}>
                      <Plus className="mr-2 h-4 w-4" /> {tk('addDoc')}
                    </Button>
                    {hasEmbeddingsKey && docs.length > 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void reindex()}
                        disabled={reindexing}
                        title={tk('reindexTooltip')}
                      >
                        {reindexing ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        {tk('reindex')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatStorePrice(item: StoreItem): string | null {
  const min = String(item.price_min ?? '').trim();
  const max = String(item.price_max ?? '').trim();
  if (!min && !max) return null;
  const amount = min && max && min !== max ? `${min}–${max}` : min || max;
  const currency = String(item.currency ?? '').trim();
  return currency ? `${amount} ${currency}` : amount;
}

function ShopifyGroup({
  title,
  items,
  emptyBody,
  kindLabel,
  showPrice = false,
  defaultOpen = false,
  collapseLabel,
  expandLabel,
  inStockLabel,
  outOfStockLabel,
  variantsLabel,
}: {
  title: string;
  items: StoreItem[];
  emptyBody: string;
  kindLabel: string;
  showPrice?: boolean;
  defaultOpen?: boolean;
  collapseLabel?: string;
  expandLabel?: string;
  inStockLabel?: string;
  outOfStockLabel?: string;
  variantsLabel?: string;
}) {
  const [allOpen, setAllOpen] = useState(defaultOpen);
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const root = listRef.current;
    if (!root) return;
    root.querySelectorAll('details').forEach((node) => {
      node.open = allOpen;
    });
  }, [allOpen, items.length]);
  if (items.length === 0) return null;
  const showToggle = Boolean(collapseLabel && expandLabel);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {showToggle ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAllOpen((open) => !open)}
          >
            {allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
            {allOpen ? collapseLabel : expandLabel}
          </Button>
        ) : null}
      </div>
      <ul ref={listRef} className="divide-y divide-border rounded-md border border-border">
        {items.map((item) => {
          const price = showPrice ? formatStorePrice(item) : null;
          const body = item.body?.trim() ?? '';
          const variants = item.variants ?? [];
          return (
            <li key={item.id}>
              <details className="group px-3 py-2">
                <summary className="flex cursor-pointer list-none items-start justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-start gap-3">
                    {item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.image_url}
                        alt=""
                        className="mt-0.5 size-12 shrink-0 rounded-md object-cover"
                      />
                    ) : null}
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">{item.title}</span>
                      {price ? (
                        <span className="block text-xs text-muted-foreground">{price}</span>
                      ) : null}
                      {item.page_url ? (
                        <a
                          href={item.page_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                          {safeHost(item.page_url)}
                        </a>
                      ) : null}
                    </span>
                  </span>
                  <Badge variant="secondary">{kindLabel}</Badge>
                </summary>
                <div className="mt-2 space-y-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {body ? (
                    <p className="whitespace-pre-wrap break-words">{body}</p>
                  ) : (
                    <p>{emptyBody}</p>
                  )}
                  {variants.length > 0 ? (
                    <div>
                      <p className="font-medium text-foreground">
                        {variantsLabel} ({variants.length})
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {variants.map((variant, index) => (
                          <li key={`${item.id}-v-${index}`}>
                            {variant.title}
                            {variant.price ? ` · ${variant.price}` : ''}
                            {item.currency ? ` ${item.currency}` : ''}
                            {variant.sku ? ` · ${variant.sku}` : ''}
                            {' · '}
                            {variant.available === false ? outOfStockLabel : inStockLabel}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}
