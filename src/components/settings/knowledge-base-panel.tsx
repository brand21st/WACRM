'use client';

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { toast } from 'sonner';
import {
  BookOpen,
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
}

interface ScrapeJob {
  id: string;
  start_url: string;
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
  const lastStartedRef = useRef('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);

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
        if (!cancelled) {
          setShopifyConnected(Boolean(data.configured) && data.is_active !== false);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
        if (next.status === 'failed') {
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
          if (next.status === 'failed') toast.error(next.error ?? t('scrapeFailed'));
          else {
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
      const maybeUrl = extractHttpUrl(title) ?? extractHttpUrl(content);
      const titleIsUrl = Boolean(extractHttpUrl(title) && title.trim() === extractHttpUrl(title));
      const contentIsUrl = Boolean(
        extractHttpUrl(content) && content.trim() === extractHttpUrl(content),
      );
      if (maybeUrl && (titleIsUrl || contentIsUrl)) {
        cancelEdit();
        void startScrape(maybeUrl);
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

  const syncShopify = async () => {
    setShopifySyncing(true);
    try {
      const res = await fetch('/api/shopify/content/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('shopifySynced', { count: data.count ?? 0 }));
      } else {
        toast.error(data.error ?? t('shopifySyncFailed'));
      }
    } catch {
      toast.error(t('shopifySyncFailed'));
    } finally {
      setShopifySyncing(false);
    }
  };

  let learningHost = '';
  if (job?.start_url) {
    try {
      learningHost = new URL(job.start_url).hostname;
    } catch {
      learningHost = job.start_url;
    }
  }

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
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('learning', { host: learningHost || '…' })}
                {job ? ` ${job.pages_saved}/${Math.max(job.pages_found, 1)}` : null}
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
            <CardContent>
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
                {docs.length === 0 && editing === null ? (
                  <p className="text-sm text-muted-foreground">{tk('noDocs')}</p>
                ) : null}

                {docs.length > 0 ? (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {docs.map((doc) => (
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

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw;
  }
}
