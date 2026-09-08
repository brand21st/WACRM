'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Search, ShoppingBag, X } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CatalogListItem } from '@/lib/catalog/http';

interface CatalogCollection {
  id: string;
  title: string;
  handle: string;
  status: 'draft' | 'active' | 'archived';
  productIds: string[];
  productCount: number;
  metaSynced: boolean;
}

export function CollectionEditor({ collectionId }: { collectionId?: string }) {
  const t = useTranslations('Catalog.collections');
  const canEdit = useCan('edit-settings');
  const router = useRouter();
  const isNew = !collectionId;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [status, setStatus] = useState<CatalogCollection['status']>('active');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [products, setProducts] = useState<CatalogListItem[]>([]);
  const [search, setSearch] = useState('');
  const [metaSynced, setMetaSynced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const listRes = await fetch('/api/catalog?limit=100', { cache: 'no-store' });
        const listData = await listRes.json();
        if (listRes.ok && Array.isArray(listData.products) && !cancelled) {
          setProducts(listData.products);
        }
        if (isNew) return;
        setLoading(true);
        const res = await fetch(`/api/catalog/sets/${collectionId}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('loadFailed'));
        if (cancelled) return;
        const collection = data.set as CatalogCollection;
        setTitle(collection.title ?? '');
        setHandle(collection.handle ?? '');
        setStatus(collection.status ?? 'active');
        setProductIds(collection.productIds ?? []);
        setMetaSynced(Boolean(collection.metaSynced));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [collectionId, isNew, t]);

  const members = useMemo(
    () => products.filter((product) => productIds.includes(product.id)),
    [productIds, products],
  );
  const addable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((product) => {
      if (productIds.includes(product.id)) return false;
      if (!q) return true;
      return (
        product.title.toLowerCase().includes(q) ||
        product.handle.toLowerCase().includes(q)
      );
    });
  }, [productIds, products, search]);

  const save = async (nextStatus = status) => {
    const name = title.trim();
    if (!name) {
      toast.error(t('nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        isNew ? '/api/catalog/sets' : `/api/catalog/sets/${collectionId}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: name,
            handle,
            status: nextStatus,
            productIds,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : t('saveFailed'));
      }
      toast.success(t('saved'));
      if (isNew && data.set?.id) {
        router.replace(`/catalog/collections/${data.set.id}`);
        return;
      }
      const collection = data.set as CatalogCollection | undefined;
      if (collection) {
        setStatus(collection.status);
        setHandle(collection.handle);
        setProductIds(collection.productIds ?? []);
        setMetaSynced(Boolean(collection.metaSynced));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!collectionId) return;
    if (!window.confirm(t('deleteConfirm'))) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/catalog/sets/${collectionId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('deleteFailed'));
      toast.success(t('deleted'));
      router.push('/catalog/collections');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('deleteFailed'));
      setSaving(false);
    }
  };

  const addProduct = (id: string) => {
    setProductIds((current) => (current.includes(id) ? current : [...current, id]));
  };

  const removeProduct = (id: string) => {
    setProductIds((current) => current.filter((item) => item !== id));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/catalog/collections"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t('back')}
          </Link>
          <h1 className="text-2xl font-bold text-foreground">
            {isNew ? t('createTitle') : t('editTitle')}
          </h1>
          {!isNew ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {metaSynced ? t('metaSynced') : t('metaNotPublished')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!isNew ? (
            <GatedButton
              canAct={canEdit}
              gateReason="delete this collection"
              variant="outline"
              onClick={() => void remove()}
              disabled={saving}
            >
              {t('delete')}
            </GatedButton>
          ) : null}
          <GatedButton
            canAct={canEdit}
            gateReason="save this collection"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('save')}
          </GatedButton>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('details')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={t('name')}>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label={t('handle')}>
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={!canEdit}
              placeholder={t('handleHint')}
            />
          </Field>
          <Field label={t('status')}>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as CatalogCollection['status'])
              }
              disabled={!canEdit}
            >
              <option value="active">{t('statusActive')}</option>
              <option value="archived">{t('statusArchived')}</option>
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('members', { count: productIds.length })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noMembers')}</p>
          ) : (
            <ul className="space-y-2">
              {members.map((product) => (
                <li
                  key={product.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      className="h-10 w-10 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                      <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <Link
                    href={`/catalog/${product.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                  >
                    {product.title}
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!canEdit}
                    onClick={() => removeProduct(product.id)}
                  >
                    <X className="h-4 w-4" />
                    {t('remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('addProducts')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchProducts')}
              className="pl-8"
              disabled={!canEdit}
            />
          </div>
          {addable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noAddable')}</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {addable.map((product) => (
                <li
                  key={product.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2"
                >
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      className="h-10 w-10 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                      <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {product.title}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canEdit}
                    onClick={() => addProduct(product.id)}
                  >
                    {t('add')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
