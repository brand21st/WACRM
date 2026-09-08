'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface EditorVariant {
  title: string;
  sku: string;
  price: string;
  compareAtPrice: string;
  available: boolean;
  inventoryQuantity: string;
  options: { name: string; value: string }[];
  retailerId?: string;
}

interface EditorMedia {
  url: string;
  alt: string;
  storagePath: string | null;
}

interface EditorCollection {
  id: string;
  title: string;
}

interface ProductAnalytics {
  asked: number;
  shown: number;
  addedToCart: number;
  purchased: number;
}

const emptyVariant = (): EditorVariant => ({
  title: 'Default',
  sku: '',
  price: '',
  compareAtPrice: '',
  available: true,
  inventoryQuantity: '',
  options: [],
});

export function ProductEditor({ productId }: { productId?: string }) {
  const t = useTranslations('Catalog.editor');
  const ta = useTranslations('Catalog.analytics');
  const canEdit = useCan('edit-settings');
  const router = useRouter();
  const isNew = !productId;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [handle, setHandle] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>('draft');
  const [variants, setVariants] = useState<EditorVariant[]>([emptyVariant()]);
  const [media, setMedia] = useState<EditorMedia[]>([]);
  const [collections, setCollections] = useState<EditorCollection[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [analytics, setAnalytics] = useState<ProductAnalytics | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (isNew) {
      void fetch('/api/catalog/setup', { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => setCollections(data.collections ?? []))
        .catch(() => {});
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/catalog/${productId}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('loadFailed'));
        if (cancelled) return;
        const product = data.product;
        setTitle(product.title ?? '');
        setDescription(product.description ?? '');
        setBrand(product.brand ?? '');
        setHandle(product.handle ?? '');
        setProductUrl(product.productUrl ?? '');
        setCurrency(product.currency ?? 'INR');
        setStatus(product.status ?? 'draft');
        setVariants(
          (product.variants ?? []).length > 0
            ? product.variants.map((variant: {
                title?: string;
                sku?: string | null;
                price?: number | null;
                compareAtPrice?: number | null;
                available?: boolean;
                inventoryQuantity?: number | null;
                options?: { name: string; value: string }[];
                retailerId?: string;
              }) => ({
                title: variant.title || 'Default',
                sku: variant.sku ?? '',
                price: variant.price != null ? String(variant.price) : '',
                compareAtPrice:
                  variant.compareAtPrice != null ? String(variant.compareAtPrice) : '',
                available: variant.available !== false,
                inventoryQuantity:
                  variant.inventoryQuantity != null ? String(variant.inventoryQuantity) : '',
                options: variant.options ?? [],
                retailerId: variant.retailerId,
              }))
            : [emptyVariant()],
        );
        setMedia(
          (product.media ?? []).map((item: { url: string; alt?: string | null; storagePath?: string | null }) => ({
            url: item.url,
            alt: item.alt ?? '',
            storagePath: item.storagePath ?? null,
          })),
        );
        setCollections(data.collections ?? []);
        setCollectionIds((product.collections ?? []).map((item: { id: string }) => item.id));
        const metrics = await fetch(`/api/catalog/${productId}/analytics?range=30d`, {
          cache: 'no-store',
        }).then((r) => r.json()).catch(() => null);
        if (metrics?.enabled) {
          setAnalytics({
            asked: metrics.asked ?? 0,
            shown: metrics.shown ?? 0,
            addedToCart: metrics.addedToCart ?? 0,
            purchased: metrics.purchased ?? 0,
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, productId, t]);

  const payload = () => ({
    title,
    description,
    brand,
    handle,
    productUrl,
    currency,
    status,
    collectionIds,
    variants: variants.map((variant) => ({
      title: variant.title,
      sku: variant.sku,
      price: variant.price === '' ? null : Number(variant.price),
      compareAtPrice: variant.compareAtPrice === '' ? null : Number(variant.compareAtPrice),
      currency,
      available: variant.available,
      inventoryQuantity: variant.inventoryQuantity === '' ? null : Number(variant.inventoryQuantity),
      options: variant.options.filter((opt) => opt.name && opt.value),
      retailerId: variant.retailerId,
    })),
    media: media.map((item, index) => ({
      url: item.url,
      alt: item.alt,
      role: index === 0 ? 'hero' : 'listing',
      sortOrder: index,
      storagePath: item.storagePath,
    })),
  });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(isNew ? '/api/catalog' : `/api/catalog/${productId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : t('saveFailed'));
      toast.success(t('saved'));
      if (isNew && data.product?.id) router.replace(`/catalog/${data.product.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setStatusRemote = async (action: 'archive' | 'publish') => {
    if (!productId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/catalog/${productId}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('saveFailed'));
      setStatus(data.product.status);
      toast.success(action === 'archive' ? t('archived') : t('published'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!productId) return;
    if (!window.confirm(t('deleteConfirm'))) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/catalog/${productId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('deleteFailed'));
      toast.success(t('deleted'));
      router.push('/catalog');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('deleteFailed'));
      setSaving(false);
    }
  };

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: EditorMedia[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set('file', file);
        const res = await fetch('/api/catalog/media', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('uploadFailed'));
        uploaded.push({ url: data.url, alt: '', storagePath: data.path });
      }
      setMedia((current) => [...current, ...uploaded]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setUploading(false);
    }
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
          <Link href="/catalog" className="text-sm text-muted-foreground hover:text-foreground">
            {t('back')}
          </Link>
          <h1 className="text-2xl font-bold text-foreground">
            {isNew ? t('createTitle') : t('editTitle')}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isNew && status !== 'archived' ? (
            <GatedButton
              canAct={canEdit}
              gateReason="archive this product"
              variant="outline"
              onClick={() => void setStatusRemote('archive')}
              disabled={saving}
            >
              {t('archive')}
            </GatedButton>
          ) : null}
          {!isNew && status !== 'active' ? (
            <GatedButton
              canAct={canEdit}
              gateReason="publish this product"
              variant="outline"
              onClick={() => void setStatusRemote('publish')}
              disabled={saving}
            >
              {t('publish')}
            </GatedButton>
          ) : null}
          <GatedButton
            canAct={canEdit}
            gateReason="save this product"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('save')}
          </GatedButton>
        </div>
      </div>

      {analytics && (analytics.asked || analytics.shown || analytics.addedToCart || analytics.purchased) ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ta('interestTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-4">
            <Metric label={ta('asked')} value={analytics.asked} />
            {analytics.shown > 0 ? <Metric label={ta('shown')} value={analytics.shown} /> : null}
            <Metric label={ta('addedToCart')} value={analytics.addedToCart} />
            <Metric label={ta('purchased')} value={analytics.purchased} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <Field label={t('name')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
          </Field>
          <Field label={t('description')}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('brand')}>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label={t('handle')}>
              <Input value={handle} onChange={(e) => setHandle(e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label={t('url')}>
              <Input value={productUrl} onChange={(e) => setProductUrl(e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label={t('currency')}>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!canEdit} />
            </Field>
            <Field label={t('status')}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                disabled={!canEdit}
              >
                <option value="draft">{t('statusDraft')}</option>
                <option value="active">{t('statusActive')}</option>
                <option value="archived">{t('statusArchived')}</option>
              </select>
            </Field>
          </div>
          <Field label={t('collections')}>
            <div className="flex flex-wrap items-center gap-2">
              {collections.map((collection) => {
                const checked = collectionIds.includes(collection.id);
                return (
                  <label key={collection.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canEdit}
                      onChange={() =>
                        setCollectionIds((current) =>
                          checked
                            ? current.filter((id) => id !== collection.id)
                            : [...current, collection.id],
                        )
                      }
                    />
                    {collection.title}
                  </label>
                );
              })}
              <Link href="/catalog/collections/new" className="text-sm text-primary hover:underline">
                {t('createCollection')}
              </Link>
            </div>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t('images')}</CardTitle>
          <label className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), canEdit ? 'cursor-pointer' : 'pointer-events-none opacity-50')}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t('upload')}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              disabled={!canEdit || uploading}
              onChange={(e) => void uploadImages(e.target.files)}
            />
          </label>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {media.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noImages')}</p>
          ) : (
            media.map((item, index) => (
              <div key={`${item.url}-${index}`} className="space-y-2 rounded-md border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt="" className="h-28 w-full rounded object-cover" />
                <Input
                  value={item.alt}
                  placeholder={t('alt')}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setMedia((current) =>
                      current.map((row, i) => (i === index ? { ...row, alt: e.target.value } : row)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => setMedia((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('removeImage')}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t('variants')}</CardTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canEdit}
            onClick={() => setVariants((current) => [...current, emptyVariant()])}
          >
            <Plus className="h-4 w-4" />
            {t('addVariant')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {variants.map((variant, index) => (
            <div key={index} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <Field label={t('variantTitle')}>
                <Input
                  value={variant.title}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setVariants((current) =>
                      current.map((row, i) => (i === index ? { ...row, title: e.target.value } : row)),
                    )
                  }
                />
              </Field>
              <Field label={t('sku')}>
                <Input
                  value={variant.sku}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setVariants((current) =>
                      current.map((row, i) => (i === index ? { ...row, sku: e.target.value } : row)),
                    )
                  }
                />
              </Field>
              <Field label={t('price')}>
                <Input
                  type="number"
                  value={variant.price}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setVariants((current) =>
                      current.map((row, i) => (i === index ? { ...row, price: e.target.value } : row)),
                    )
                  }
                />
              </Field>
              <Field label={t('compareAt')}>
                <Input
                  type="number"
                  value={variant.compareAtPrice}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setVariants((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, compareAtPrice: e.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <Field label={t('stock')}>
                <Input
                  type="number"
                  value={variant.inventoryQuantity}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setVariants((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, inventoryQuantity: e.target.value } : row,
                      ),
                    )
                  }
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={variant.available}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setVariants((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, available: e.target.checked } : row,
                      ),
                    )
                  }
                />
                {t('available')}
              </label>
              <Field label={t('options')}>
                <Input
                  placeholder={t('optionsPlaceholder')}
                  value={variant.options.map((opt) => `${opt.name}:${opt.value}`).join(', ')}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setVariants((current) =>
                      current.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              options: e.target.value
                                .split(',')
                                .map((part) => part.trim())
                                .filter(Boolean)
                                .map((part) => {
                                  const [name, ...rest] = part.split(':');
                                  return { name: name.trim(), value: rest.join(':').trim() };
                                })
                                .filter((opt) => opt.name && opt.value),
                            }
                          : row,
                      ),
                    )
                  }
                />
              </Field>
              {variants.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canEdit}
                  onClick={() => setVariants((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                  {t('removeVariant')}
                </Button>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {!isNew ? (
        <div className="flex justify-end">
          <GatedButton
            canAct={canEdit}
            gateReason="delete this product"
            variant="destructive"
            onClick={() => void remove()}
            disabled={saving}
          >
            {t('delete')}
          </GatedButton>
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
