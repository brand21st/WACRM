'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Loader2, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { UpgradePlanBanner } from './upgrade-plan-banner';
import { useEntitlements } from '@/hooks/use-entitlements';
import { ShopifyNotificationsCard } from './shopify-notifications';
import { SHOPIFY_PARTNER_SCOPES } from '@/lib/shopify/scopes';
import { SHOPIFY_WEBHOOK_TOPICS } from '@/lib/shopify/webhook-topics';

const MASKED_TOKEN = '••••••••••••••••';

function siteOrigin(): string {
  if (typeof window === 'undefined') return '';
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  return fromEnv || window.location.origin;
}

function CopyUrlField({
  label,
  value,
  hint,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  hint?: string;
  onCopy: (value: string) => void;
  copyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          className="bg-muted border-border text-muted-foreground font-mono text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onCopy(value)}
          className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          aria-label={copyLabel}
        >
          <Copy className="size-4" />
        </Button>
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface ShopifyConfigResponse {
  configured?: boolean;
  has_token?: boolean;
  shop_domain?: string;
  shop_name?: string | null;
  primary_domain?: string | null;
  currency?: string | null;
  client_id?: string | null;
  is_active?: boolean;
  meta_catalog_id?: string | null;
  last_verified_at?: string | null;
  last_catalog_sync_at?: string | null;
  catalog_product_count?: number;
  last_content_sync_at?: string | null;
  content_item_count?: number;
}

export function ShopifyConfigPanel() {
  const t = useTranslations('Settings.shopify');
  const { canEditSettings, accountId, loading: authLoading } = useAuth();
  const { entitlements } = useEntitlements();
  const loadedAccountIdRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [shopDomain, setShopDomain] = useState('');
  const [clientId, setClientId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [metaCatalogId, setMetaCatalogId] = useState('');
  const [shopName, setShopName] = useState<string | null>(null);
  const [primaryDomain, setPrimaryDomain] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [productCount, setProductCount] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [contentCount, setContentCount] = useState(0);
  const [lastContentSync, setLastContentSync] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const origin = siteOrigin();
  const appUrl = origin ? `${origin}/settings?tab=shopify` : '';
  const callbackUrl = origin ? `${origin}/api/shopify/oauth/callback` : '';
  const webhookUrl = origin ? `${origin}/api/shopify/webhook` : '';
  const scopes = SHOPIFY_PARTNER_SCOPES;
  const webhookTopics = SHOPIFY_WEBHOOK_TOPICS.join(', ');

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(t('copySuccess'));
      } catch {
        toast.error(t('copyFailed'));
      }
    },
    [t],
  );

  const applyPayload = useCallback((data: ShopifyConfigResponse) => {
    setConfigured(Boolean(data.configured));
    setShopDomain(data.shop_domain ?? '');
    setClientId(data.client_id ?? '');
    setAccessToken(data.has_token ? MASKED_TOKEN : '');
    setTokenEdited(false);
    setIsActive(data.is_active !== false);
    setMetaCatalogId(data.meta_catalog_id ?? '');
    setShopName(data.shop_name ?? null);
    setPrimaryDomain(data.primary_domain ?? null);
    setCurrency(data.currency ?? null);
    setProductCount(data.catalog_product_count ?? 0);
    setLastSync(data.last_catalog_sync_at ?? null);
    setContentCount(data.content_item_count ?? 0);
    setLastContentSync(data.last_content_sync_at ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/shopify/config', { cache: 'no-store' });
      const data = (await res.json()) as ShopifyConfigResponse;
      applyPayload(data);
    } catch {
      toast.error(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [applyPayload, t]);

  useEffect(() => {
    if (!accountId || authLoading) return;
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void load();
  }, [accountId, authLoading, load]);

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/shopify/config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_domain: shopDomain,
          client_id: clientId || null,
          access_token: tokenEdited ? accessToken : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('testFailed'));
        return;
      }
      setShopName(data.shop_name ?? null);
      setPrimaryDomain(data.primary_domain ?? null);
      setCurrency(data.currency ?? null);
      toast.success(
        data.shop_name
          ? t('testSuccessNamed', { name: data.shop_name })
          : t('testSuccess'),
      );
    } catch {
      toast.error(t('testFailed'));
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/shopify/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_domain: shopDomain,
          client_id: clientId || null,
          access_token: tokenEdited ? accessToken : undefined,
          is_active: isActive,
          meta_catalog_id: metaCatalogId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        return;
      }
      applyPayload({ ...data, configured: true, has_token: true });
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/shopify/catalog/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('syncFailed'));
        return;
      }
      setProductCount(data.count ?? 0);
      setLastSync(data.last_catalog_sync_at ?? new Date().toISOString());
      if (typeof data.content_count === 'number') {
        setContentCount(data.content_count);
      }
      if (data.last_content_sync_at) {
        setLastContentSync(data.last_content_sync_at);
      }
      if (data.content_warning) {
        toast.warning(data.content_warning);
      }
      toast.success(t('synced', { count: data.count ?? 0 }));
    } catch {
      toast.error(t('syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/shopify/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('disconnectFailed'));
        return;
      }
      applyPayload({ configured: false });
      setShopDomain('');
      setClientId('');
      setAccessToken('');
      toast.success(t('disconnected'));
    } catch {
      toast.error(t('disconnectFailed'));
    } finally {
      setDisconnecting(false);
    }
  };

  const disabled =
    !canEditSettings || loading || entitlements?.shopifyEnabled === false;

  const installOnStore = async () => {
    if (!shopDomain.trim() || !clientId.trim()) {
      toast.error(t('saveFailed'));
      return;
    }
    setInstalling(true);
    try {
      const res = await fetch('/api/shopify/oauth/install-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_domain: shopDomain,
          client_id: clientId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('installFailed'));
        return;
      }
      window.open(data.install_url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error(t('installFailed'));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <UpgradePlanBanner allowed={entitlements?.shopifyEnabled} />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('loading')}
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('devAppTitle')}</CardTitle>
              <CardDescription>{t('devAppDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CopyUrlField
                label={t('appUrl')}
                value={appUrl}
                onCopy={copyToClipboard}
                copyLabel={t('copy')}
              />
              <CopyUrlField
                label={t('callbackUrl')}
                value={callbackUrl}
                onCopy={copyToClipboard}
                copyLabel={t('copy')}
              />
              <CopyUrlField
                label={t('webhookUrl')}
                value={webhookUrl}
                hint={t('webhookUrlHint')}
                onCopy={copyToClipboard}
                copyLabel={t('copy')}
              />
              <CopyUrlField
                label={t('webhookTopics')}
                value={webhookTopics}
                hint={t('webhookTopicsHint')}
                onCopy={copyToClipboard}
                copyLabel={t('copy')}
              />
              <CopyUrlField
                label={t('scopes')}
                value={scopes}
                hint={t('scopesHint')}
                onCopy={copyToClipboard}
                copyLabel={t('copy')}
              />
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void installOnStore()}
                  disabled={
                    disabled ||
                    installing ||
                    !shopDomain.trim() ||
                    !clientId.trim()
                  }
                >
                  {installing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {t('installApp')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('installAppHint')}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBag className="h-4 w-4" />
                {shopName || t('connection')}
              </CardTitle>
              <CardDescription>{t('connectionDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="shop-domain">{t('shopDomain')}</Label>
                <Input
                  id="shop-domain"
                  placeholder="your-store.myshopify.com"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  disabled={disabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="shop-client-id">{t('clientId')}</Label>
                <Input
                  id="shop-client-id"
                  placeholder={t('clientIdPlaceholder')}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  disabled={disabled}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">{t('clientIdHint')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="shop-token">{t('accessToken')}</Label>
                <Input
                  id="shop-token"
                  type="password"
                  placeholder={t('accessTokenPlaceholder')}
                  value={accessToken}
                  onChange={(e) => {
                    setAccessToken(e.target.value);
                    setTokenEdited(true);
                  }}
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">{t('accessTokenHint')}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="meta-catalog">{t('metaCatalog')}</Label>
                <Input
                  id="meta-catalog"
                  placeholder={t('metaCatalogPlaceholder')}
                  value={metaCatalogId}
                  onChange={(e) => setMetaCatalogId(e.target.value)}
                  disabled={disabled}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('active')}</p>
                  <p className="text-xs text-muted-foreground">{t('activeDesc')}</p>
                </div>
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  disabled={disabled}
                />
              </div>
              {primaryDomain ? (
                <p className="text-xs text-muted-foreground">
                  {primaryDomain}
                  {currency ? ` · ${currency}` : ''}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => void testConnection()}
                  disabled={disabled || testing || saving}
                >
                  {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('testConnection')}
                </Button>
                <Button onClick={() => void save()} disabled={disabled || saving || testing}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('save')}
                </Button>
                {configured ? (
                  <Button
                    variant="outline"
                    onClick={() => void disconnect()}
                    disabled={disabled || disconnecting}
                  >
                    {t('disconnect')}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('catalogTitle')}</CardTitle>
              <CardDescription>{t('catalogDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t('catalogStatus', {
                  count: productCount,
                  synced: lastSync
                    ? new Date(lastSync).toLocaleString()
                    : t('neverSynced'),
                })}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('contentStatus', {
                  count: contentCount,
                  synced: lastContentSync
                    ? new Date(lastContentSync).toLocaleString()
                    : t('neverSynced'),
                })}
              </p>
              <p className="text-xs text-muted-foreground">{t('contentHint')}</p>
              <Button
                variant="secondary"
                onClick={() => void sync()}
                disabled={disabled || !configured || syncing}
              >
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('sync')}
              </Button>
            </CardContent>
          </Card>

          <ShopifyNotificationsCard configured={configured} disabled={disabled} />
        </div>
      )}
    </div>
  );
}
