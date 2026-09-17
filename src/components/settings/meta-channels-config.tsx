'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { SettingsPanelHead } from '@/components/settings/settings-panel-head';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';

type ConnectState = {
  connected: boolean;
  reason?: string;
  page_id?: string;
  page_name?: string | null;
  ig_username?: string | null;
  messenger_status?: string;
  instagram_status?: string;
  last_error?: string | null;
  token_expires_at?: string | null;
  needs_replace?: boolean;
  current_page_name?: string | null;
};

type LaunchConfig = {
  appId: string;
  configId: string;
  graphVersion: string;
  enabled: boolean;
};

type FacebookAuthResponse = {
  code?: string;
  accessToken?: string;
};

type FacebookSdk = {
  init: (opts: Record<string, unknown>) => void;
  login: (
    cb: (res: { authResponse?: FacebookAuthResponse | null }) => void,
    opts: Record<string, unknown>,
  ) => void;
};

const FACEBOOK_PAGE_SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'pages_read_engagement',
  'instagram_basic',
  'instagram_manage_messages',
  'business_management',
].join(',');

function getFacebookSdk(): FacebookSdk | undefined {
  return (window as unknown as { FB?: FacebookSdk }).FB;
}

export function MetaChannelsConfig() {
  const t = useTranslations('Settings.meta');
  const { canEditSettings } = useAuth();
  const [launch, setLaunch] = useState<LaunchConfig | null>(null);
  const [status, setStatus] = useState<ConnectState | null>(null);
  const [busy, setBusy] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(
    null,
  );

  const refresh = useCallback(async () => {
    const [launchRes, statusRes] = await Promise.all([
      fetch('/api/meta/launch-config'),
      fetch('/api/meta/connect'),
    ]);
    if (launchRes.ok) setLaunch(await launchRes.json());
    if (statusRes.ok) setStatus(await statusRes.json());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function postConnect(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch('/api/meta/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ConnectState & { error?: string };
      if (res.status === 409 && data.needs_replace) {
        setPendingBody(body);
        setReplaceOpen(true);
        setStatus(data);
        return;
      }
      if (!res.ok) {
        toast.error(data.error || t('connectFailed'));
        return;
      }
      toast.success(t('connectedToast'));
      await refresh();
    } catch {
      toast.error(t('connectFailed'));
    } finally {
      setBusy(false);
      setPopupOpen(false);
    }
  }

  function loginWithFacebook(attempt = 0) {
    const FB = getFacebookSdk();
    if (!FB) {
      if (attempt < 12) {
        window.setTimeout(() => loginWithFacebook(attempt + 1), 200);
        return;
      }
      toast.error(t('sdkNotReady'));
      return;
    }
    setPopupOpen(true);
    const useBusinessLogin =
      Boolean(launch?.configId) && window.location.protocol === 'https:';
    FB.login(
      (response) => {
        const auth = response.authResponse;
        if (!auth) {
          setPopupOpen(false);
          toast.error(t('loginCancelled'));
          return;
        }
        if (auth.code) {
          void postConnect({ code: auth.code });
          return;
        }
        if (auth.accessToken) {
          void postConnect({ user_access_token: auth.accessToken });
          return;
        }
        setPopupOpen(false);
        toast.error(t('connectFailed'));
      },
      useBusinessLogin
        ? {
            config_id: launch?.configId,
            response_type: 'code',
            override_default_response_type: true,
          }
        : {
            scope: FACEBOOK_PAGE_SCOPES,
            return_scopes: true,
          },
    );
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch('/api/meta/connect', { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('disconnectFailed'));
        return;
      }
      toast.success(t('disconnectedToast'));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(status?.connected);
  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/meta/webhook`
      : '/api/meta/webhook';

  return (
    <div>
      {launch?.appId && (
        <Script
          src="https://connect.facebook.net/en_US/sdk.js"
          strategy="afterInteractive"
          onLoad={() => {
            const w = window as unknown as {
              FB?: FacebookSdk;
              fbAsyncInit?: () => void;
            };
            w.fbAsyncInit = () => {
              w.FB?.init({
                appId: launch.appId,
                cookie: true,
                xfbml: false,
                version: launch.graphVersion,
              });
            };
            w.fbAsyncInit();
          }}
        />
      )}

      <SettingsPanelHead title={t('title')} description={t('description')} />

      <div className="mb-6 rounded-xl border border-border bg-card p-5">
        {popupOpen || busy ? (
          <p className="text-sm text-muted-foreground">{t('connecting')}</p>
        ) : connected ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {status?.instagram_status === 'connected'
                ? t('connectedBoth', {
                    page: status?.page_name || t('facebookPage'),
                    username: status?.ig_username || 'instagram',
                  })
                : t('connectedMessenger', {
                    page: status?.page_name || t('facebookPage'),
                  })}
            </p>
            {status?.instagram_status !== 'connected' && (
              <p className="text-xs text-muted-foreground">{t('noInstagram')}</p>
            )}
            {status?.last_error && (
              <p className="text-xs text-amber-600">{status.last_error}</p>
            )}
            <p className="text-xs text-muted-foreground">{t('connectedTools')}</p>
            {canEditSettings && (
              <Button variant="outline" size="sm" onClick={() => void disconnect()}>
                {t('disconnect')}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('pitch')}</p>
            {canEditSettings && launch?.enabled && (
              <Button
                className="h-11 w-full bg-[#1877F2] text-white hover:bg-[#166FE5]"
                disabled={busy || popupOpen}
                onClick={() => loginWithFacebook()}
              >
                {t('connectButton')}
              </Button>
            )}
          </div>
        )}
      </div>

      {replaceOpen && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="mb-3">
            {t('replaceConfirm', {
              page: status?.current_page_name || t('facebookPage'),
            })}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (pendingBody) {
                  void postConnect({ ...pendingBody, replace: true });
                }
                setReplaceOpen(false);
              }}
            >
              {t('replace')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setReplaceOpen(false);
                setPendingBody(null);
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </div>
      )}

      {canEditSettings && (
        <details className="rounded-xl border border-border bg-card p-5">
          <summary className="cursor-pointer text-sm font-medium">
            {t('advancedTitle')}
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('webhookUrl')}: <code className="break-all">{webhookUrl}</code>
            </p>
            <Input
              placeholder={t('pageId')}
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
            />
            <Input
              type="password"
              placeholder={t('pageToken')}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
            <Input
              placeholder={t('verifyToken')}
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
            />
            <Button
              disabled={busy || !pageId || !accessToken}
              onClick={() =>
                void postConnect({
                  page_id: pageId,
                  access_token: accessToken,
                  verify_token: verifyToken || undefined,
                })
              }
            >
              {t('saveManual')}
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}
