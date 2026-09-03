"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Flags = {
  openai: boolean;
  anthropic: boolean;
  embeddings: boolean;
  elevenlabs: boolean;
  sarvam: boolean;
};

const emptyFlags: Flags = {
  openai: false,
  anthropic: false,
  embeddings: false,
  elevenlabs: false,
  sarvam: false,
};

export default function SuperAdminAiPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [chatProvider, setChatProvider] = useState("openai");
  const [chatModel, setChatModel] = useState("");
  const [voiceProvider, setVoiceProvider] = useState("elevenlabs");
  const [globalOn, setGlobalOn] = useState(true);
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [embeddingsKey, setEmbeddingsKey] = useState("");
  const [elevenlabsKey, setElevenlabsKey] = useState("");
  const [sarvamKey, setSarvamKey] = useState("");
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [flags, setFlags] = useState<Flags>(emptyFlags);

  const applyPayload = useCallback((d: Record<string, unknown>) => {
    setChatProvider(typeof d.chat_provider === "string" ? d.chat_provider : "openai");
    setChatModel(typeof d.chat_model === "string" ? d.chat_model : "");
    setVoiceProvider(typeof d.voice_provider === "string" ? d.voice_provider : "elevenlabs");
    setGlobalOn(d.global_ai_enabled !== false);
    setFlags({
      openai: Boolean(d.has_openai_key),
      anthropic: Boolean(d.has_anthropic_key),
      embeddings: Boolean(d.has_embeddings_key),
      elevenlabs: Boolean(d.has_elevenlabs_key),
      sarvam: Boolean(d.has_sarvam_key),
    });
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/super-admin/ai");
    const d = await res.json().catch(() => ({}));
    if (res.ok) applyPayload(d);
    return res.ok;
  }, [applyPayload]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_provider: chatProvider,
          chat_model: chatModel,
          voice_provider: voiceProvider,
          global_ai_enabled: globalOn,
          openai_api_key: clear.openai ? null : openaiKey || undefined,
          anthropic_api_key: clear.anthropic ? null : anthropicKey || undefined,
          embeddings_api_key: clear.embeddings ? null : embeddingsKey || undefined,
          elevenlabs_api_key: clear.elevenlabs ? null : elevenlabsKey || undefined,
          sarvam_api_key: clear.sarvam ? null : sarvamKey || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save");
        return;
      }
      toast.success("Platform AI saved — keys apply to every account");
      setOpenaiKey("");
      setAnthropicKey("");
      setEmbeddingsKey("");
      setElevenlabsKey("");
      setSarvamKey("");
      setClear({});
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform AI API</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Keys are encrypted in the database and used by every workspace. Merchants
          cannot paste their own keys.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Defaults</CardTitle>
          <CardDescription>Provider and model locked for all workspaces.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">Global AI</p>
              <p className="text-xs text-muted-foreground">Master switch for the whole platform</p>
            </div>
            <Switch checked={globalOn} onCheckedChange={setGlobalOn} />
          </div>
          <div className="space-y-2">
            <Label>Chat provider</Label>
            <Select value={chatProvider} onValueChange={(v) => { if (v) setChatProvider(v) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Chat model</Label>
            <Input value={chatModel} onChange={(e) => setChatModel(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Voice provider</Label>
            <Select value={voiceProvider} onValueChange={(v) => { if (v) setVoiceProvider(v) }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                <SelectItem value="sarvam">Sarvam</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API keys</CardTitle>
          <CardDescription>
            Stored encrypted. Leave a field blank to keep the current key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <KeyField
            label="OpenAI"
            saved={flags.openai}
            pendingClear={Boolean(clear.openai)}
            value={openaiKey}
            onChange={(v) => {
              setOpenaiKey(v);
              setClear((c) => ({ ...c, openai: false }));
            }}
            onClear={() => {
              setOpenaiKey("");
              setClear((c) => ({ ...c, openai: true }));
            }}
          />
          <KeyField
            label="Anthropic"
            saved={flags.anthropic}
            pendingClear={Boolean(clear.anthropic)}
            value={anthropicKey}
            onChange={(v) => {
              setAnthropicKey(v);
              setClear((c) => ({ ...c, anthropic: false }));
            }}
            onClear={() => {
              setAnthropicKey("");
              setClear((c) => ({ ...c, anthropic: true }));
            }}
          />
          <KeyField
            label="Embeddings"
            saved={flags.embeddings}
            pendingClear={Boolean(clear.embeddings)}
            value={embeddingsKey}
            onChange={(v) => {
              setEmbeddingsKey(v);
              setClear((c) => ({ ...c, embeddings: false }));
            }}
            onClear={() => {
              setEmbeddingsKey("");
              setClear((c) => ({ ...c, embeddings: true }));
            }}
          />
          <KeyField
            label="ElevenLabs"
            saved={flags.elevenlabs}
            pendingClear={Boolean(clear.elevenlabs)}
            value={elevenlabsKey}
            onChange={(v) => {
              setElevenlabsKey(v);
              setClear((c) => ({ ...c, elevenlabs: false }));
            }}
            onClear={() => {
              setElevenlabsKey("");
              setClear((c) => ({ ...c, elevenlabs: true }));
            }}
          />
          <KeyField
            label="Sarvam"
            saved={flags.sarvam}
            pendingClear={Boolean(clear.sarvam)}
            value={sarvamKey}
            onChange={(v) => {
              setSarvamKey(v);
              setClear((c) => ({ ...c, sarvam: false }));
            }}
            onClear={() => {
              setSarvamKey("");
              setClear((c) => ({ ...c, sarvam: true }));
            }}
          />
        </CardContent>
      </Card>
      <Button onClick={() => void save()} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

function KeyField({
  label,
  value,
  saved,
  pendingClear,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  saved: boolean;
  pendingClear: boolean;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const status = pendingClear
    ? "will clear on save"
    : saved
      ? "saved"
      : "not set";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>
          {label}{" "}
          <span className="font-normal text-muted-foreground">({status})</span>
        </Label>
        {saved && !pendingClear ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
      <Input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={saved && !pendingClear ? "Leave blank to keep the stored key" : "Paste key"}
        autoComplete="off"
        disabled={pendingClear}
      />
    </div>
  );
}
