# wacrm — App Summary

**wacrm** is a self-hostable CRM for WhatsApp Business. It is a working product template (MIT, v0.8.x): fork it, brand it, and run it on your own stack. It is not a SaaS — you own the code, database, and customer data.

One WhatsApp number maps to one account. A whole team can staff that inbox by joining the same account (owner / admin / agent / viewer).

---

## What it does

Teams use one WhatsApp Business number as a shared workspace: talk to customers, keep contacts, move deals, blast templates, and automate replies.

| Area | What you get |
|------|----------------|
| **Inbox** | Shared WhatsApp threads — assignment, status, notes, templates, reactions, quote-replies, real-time updates |
| **Contacts** | Tags, custom fields, CSV import, deduplication |
| **Pipelines** | Kanban deals linked to conversations |
| **Broadcasts** | Meta-approved templates, per-recipient variables, delivery/read tracking |
| **Automations** | No-code triggers (inbound, keyword, new contact, schedule) with branches, waits, tags, webhooks |
| **Flows** | Button-driven branching chatbots with human handoff |
| **AI agents** | BYOK OpenAI/Anthropic — draft replies, auto-reply bot, knowledge base, usage charts |
| **Voice agents** | Clone / train / build voice notes (ElevenLabs TTS) |
| **Shopify** | Connect a store, catalog bootstrap, order/fulfillment WhatsApp notifications |
| **Dashboard** | Response times, volume, pipeline value, activity feed |
| **Team** | Invite links, roles, ownership transfer, presence |
| **API + MCP** | Public REST API (`/api/v1`) and a Model Context Protocol server for AI assistants |

**Reply precedence:** Flows → Automations → AI auto-reply. Humans can take over an AI thread at any time.

---

## How it is built

| Layer | Choice |
|-------|--------|
| App | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind v4, shadcn / Base UI |
| Data + auth | Supabase (Postgres, RLS, Auth, Storage, Realtime) |
| WhatsApp | Official Meta Cloud API |
| Secrets | AES-256-GCM (`ENCRYPTION_KEY`) |
| Jobs | External HTTP cron hits `/api/automations/cron`, `/api/flows/cron`, `/api/whatsapp/broadcast/cron`, `/api/shopify/notifications/cron`, `/api/voice/cron` |

There is no separate backend and no ORM. Server routes talk to Supabase via `@supabase/ssr`.

**Inbound:** Meta → `POST /api/whatsapp/webhook` (HMAC-verified) → contact/conversation/message → automations → inbox via Realtime.

**Outbound:** composer → `POST /api/whatsapp/send` → decrypt token → Meta → persist message.

---

## Main screens

| Route | Purpose |
|-------|---------|
| `/login`, `/signup`, `/forgot-password` | Auth |
| `/dashboard` | Metrics and activity |
| `/inbox` | Shared WhatsApp inbox |
| `/notifications` | In-app notifications |
| `/contacts` | Address book |
| `/pipelines` | Deal boards |
| `/broadcasts` | Template campaigns |
| `/automations` | Event workflows |
| `/flows` | Chatbot builder |
| `/agents` | Chat AI playground, setup, usage |
| `/agents/voice` | Voice clone / training / build |
| `/settings` | WhatsApp, Shopify, API keys, members, tags, templates, appearance |

---

## Integrations

- **WhatsApp Business API** — required for messaging; tokens stored encrypted.
- **Shopify** — OAuth install, catalog, notification rules.
- **OpenAI / Anthropic** — keys saved in Settings (not env), encrypted.
- **ElevenLabs** — voice notes.
- **Public API** — scoped, revocable `wacrm_live_*` keys.
- **MCP** (`mcp-server/`) — read CRM from Cursor/Claude; writes opt-in.
- **Outbound webhooks** — `message.received`, `message.status_updated`, `conversation.created`.

---

## Security (high level)

- Row Level Security on every table; accounts are isolated.
- WhatsApp tokens and AI keys encrypted at rest.
- Webhooks verified with HMAC (`META_APP_SECRET`).
- Role checks, rate limits, CSP.
- API keys hashed (SHA-256); the full key is shown once.

---

## Run it locally

Needs Node 20+, a Supabase project, and Meta WhatsApp credentials.

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up, then connect WhatsApp under Settings before the inbox has traffic.

Full setup notes: [README.md](./README.md), [WACRM-STUDY-GUIDE.md](./WACRM-STUDY-GUIDE.md), and [wacrm.tech/docs](https://wacrm.tech/docs).
