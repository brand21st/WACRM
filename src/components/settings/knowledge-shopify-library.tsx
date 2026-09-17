'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, ShoppingBag } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { SettingsChip, StatusDot } from '@/components/settings/settings-chip';
import { cn } from '@/lib/utils';

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

function formatStorePrice(item: StoreItem): string | null {
  const min = String(item.price_min ?? '').trim();
  const max = String(item.price_max ?? '').trim();
  if (!min && !max) return null;
  const amount = min && max && min !== max ? `${min}–${max}` : min || max;
  const currency = String(item.currency ?? '').trim();
  return currency ? `${amount} ${currency}` : amount;
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}

export function KnowledgeShopifyLibrary({
  connected,
  syncing,
  canEdit,
  policies,
  pages,
  products,
  onSync,
}: {
  connected: boolean;
  syncing: boolean;
  canEdit: boolean;
  policies: StoreItem[];
  pages: StoreItem[];
  products: StoreItem[];
  onSync: () => void;
}) {
  const t = useTranslations('Settings.knowledgeBase');
  const [selectedProduct, setSelectedProduct] = useState<StoreItem | null>(null);

  if (!connected && policies.length === 0 && pages.length === 0 && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary mb-4">
          <ShoppingBag className="size-5" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">{t('shopifyTitle')}</p>
        <p className="text-sm text-muted-foreground max-w-sm mb-4">
          {t('shopifyNotConnectedDesc')}
        </p>
        {canEdit ? (
          <Link href="/settings?tab=shopify" className={buttonVariants({ variant: 'outline' })}>
            {t('shopifyConnectCTA')}
          </Link>
        ) : null}
      </div>
    );
  }

  const renderContentAccordion = (items: StoreItem[]) => {
    return (
      <Accordion type="multiple" className="w-full">
        {items.map((item) => {
          const body = item.body?.trim() ?? '';
          return (
            <AccordionItem key={item.id} value={item.id} className="border-border">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{item.title}</span>
                  <Badge variant="secondary" className="font-normal">
                    {body ? t('shopifyHasText') : t('shopifyNoText')}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                  {body || t('shopifyEmptyBody')}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary-soft text-primary">
            <ShoppingBag className="size-4" />
          </span>
          <SettingsChip variant={connected ? 'ok' : 'muted'}>
            <StatusDot tone={connected ? 'ok' : 'muted'} />
            {t('shopifyTitle')}
          </SettingsChip>
          <div className="flex items-center gap-2 text-xs text-muted-foreground ml-2">
            <Badge variant="outline" className="font-normal">
              {t('shopifyCountProducts', { count: products.length })}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {t('shopifyCountPages', { count: pages.length })}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {t('shopifyCountPolicies', { count: policies.length })}
            </Badge>
          </div>
        </div>
        {canEdit && connected ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={syncing}
          >
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('shopifySync')}
          </Button>
        ) : null}
      </div>

      <Tabs defaultValue="products">
        <TabsList className="mb-4">
          <TabsTrigger value="products">{t('shopifyTabProducts')}</TabsTrigger>
          <TabsTrigger value="pages">{t('shopifyTabPages')}</TabsTrigger>
          <TabsTrigger value="policies">{t('shopifyTabPolicies')}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="products">
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => {
              const price = formatStorePrice(product);
              const totalVariants = product.variants?.length ?? 0;
              const hasAvailable = product.variants?.some((v) => v.available) ?? false;
              
              return (
                <div
                  key={product.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-sm hover:border-ring/30 cursor-pointer transition-colors"
                  onClick={() => setSelectedProduct(product)}
                >
                  {product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={product.image_url}
                      alt=""
                      className="size-16 shrink-0 rounded-md object-cover border border-border"
                    />
                  ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-md bg-muted border border-border">
                      <ShoppingBag className="size-6 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium text-sm text-foreground">
                      {product.title}
                    </p>
                    {price ? (
                      <p className="text-xs text-muted-foreground">{price}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px]">
                      <Badge variant="secondary" className="px-1.5 font-normal text-[10px]">
                        {totalVariants} {t('shopifyVariants').toLowerCase()}
                      </Badge>
                      <Badge 
                        variant="secondary" 
                        className={cn(
                          "px-1.5 font-normal text-[10px]",
                          hasAvailable ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                        )}
                      >
                        {hasAvailable ? t('shopifyInStock') : t('shopifyOutOfStock')}
                      </Badge>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
        
        <TabsContent value="pages">
          {renderContentAccordion(pages)}
        </TabsContent>
        
        <TabsContent value="policies">
          {renderContentAccordion(policies)}
        </TabsContent>
      </Tabs>

      <Sheet open={!!selectedProduct} onOpenChange={(v) => !v && setSelectedProduct(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedProduct ? (
            <div className="space-y-6 pb-6">
              <SheetHeader>
                <SheetTitle className="text-left">{selectedProduct.title}</SheetTitle>
              </SheetHeader>
              
              {selectedProduct.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedProduct.image_url}
                  alt=""
                  className="w-full rounded-xl object-cover aspect-[4/3] border border-border"
                />
              ) : null}

              <div className="flex flex-wrap gap-2 text-sm">
                <span className="font-medium text-foreground">
                  {formatStorePrice(selectedProduct)}
                </span>
                {selectedProduct.page_url ? (
                  <a
                    href={selectedProduct.page_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {safeHost(selectedProduct.page_url)}
                  </a>
                ) : null}
              </div>

              <div className="space-y-2">
                <div className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                  {selectedProduct.body?.trim() || t('shopifyEmptyBody')}
                </div>
              </div>

              {(selectedProduct.variants?.length ?? 0) > 0 ? (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-foreground">{t('shopifyVariants')}</h4>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('colVariant')}</TableHead>
                          <TableHead>{t('colPrice')}</TableHead>
                          <TableHead>{t('colSku')}</TableHead>
                          <TableHead>{t('colStock')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedProduct.variants?.map((v, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{v.title}</TableCell>
                            <TableCell>{v.price || '—'}</TableCell>
                            <TableCell className="text-muted-foreground">{v.sku || '—'}</TableCell>
                            <TableCell>
                              <Badge 
                                variant="secondary"
                                className={cn(
                                  "font-normal",
                                  v.available ? "text-emerald-600" : "text-amber-600"
                                )}
                              >
                                {v.available ? t('shopifyInStock') : t('shopifyOutOfStock')}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
