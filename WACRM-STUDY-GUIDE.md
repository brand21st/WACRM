# wacrm — Documentation Study Guide

> **Source:** [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm) · [wacrm.tech/docs](https://wacrm.tech/docs)  
> **Version studied:** 0.8.0 · **Date:** August 24, 2026

This document consolidates the official wacrm self-host documentation for quick reference during setup, customization, and deployment.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Stack & Architecture](#2-stack--architecture)
3. [Getting Started (Local)](#3-getting-started-local)
4. [Supabase Setup](#4-supabase-setup)
5. [WhatsApp / Meta Setup](#5-whatsapp--meta-setup)
6. [Environment Variables](#6-environment-variables)
7. [Deployment](#7-deployment)
8. [Core Features](#8-core-features)
9. [Public REST API (`/api/v1`)](#9-public-rest-api-apiv1)
10. [MCP Server](#10-mcp-server)
11. [Docker](#11-docker)
12. [Automations Cron](#12-automations-cron)
13. [Security Model](#13-security-model)
14. [Database Migrations](#14-database-migrations)
15. [Troubleshooting](#15-troubleshooting)
16. [Useful Commands](#16-useful-commands)
17. [Where to Change Things](#17-where-to-change-things)

---

## 1. Overview

**wacrm** is a self-hostable CRM template for WhatsApp Business. It is MIT-licensed — fork it, brand it, host it. It is a **template**, not a SaaS product.

### What You Get Out of the Box

| Module | Description |
|--------|-------------|
| **Shared Inbox** | Multi-agent workspace on the official WhatsApp Business API — assignment, status, notes |
| **Contacts** | Tags, custom fields, CSV import, deduplication |
| **Sales Pipelines** | Kanban deal boards linked to conversations |
| **Broadcasts** | Meta-approved templates, delivery/read tracking, per-recipient variables |
| **Automations** | No-code triggers (inbound messages, keywords, schedule) with branches, waits, webhooks |
| **Flows** | Button-driven branching WhatsApp chatbots with human handoff |
| **AI Assistant** | BYOK (OpenAI/Anthropic) — draft replies, auto-reply bot, knowledge base |
| **Dashboard** | Response times, volume, pipeline value, activity feed |
| **Team Accounts** | Invite links, roles (owner/admin/agent/viewer), ownership transfer |
| **Public REST API** | Scoped API keys for external integrations |
| **MCP Server** | Drive CRM from Claude, Cursor, and other AI assistants |

### Important Design Constraint

> **One WhatsApp number = one wacrm account.** Each `phone_number_id` can only connect to a single account (DB constraint + API `409`). Multiple humans handle the same inbox by sharing **one account** with team members — not by connecting the same number to multiple logins.

---

## 2. Stack & Architecture

| Layer | Technology |
|-------|------------|
| App | Next.js 16 (App Router), React 19, TypeScript |
| UI | Tailwind v4 + shadcn/base-ui |
| Data + Auth | Supabase (Postgres, RLS, Auth, Storage, Realtime) |
| WhatsApp | Meta Cloud API (official Business API) |
| Encryption | `node:crypto` AES-256-GCM |
| Scheduler | External HTTP pinger → `GET /api/automations/cron` |

**No ORM, no GraphQL, no separate backend.** Server routes read/write Supabase via `@supabase/ssr`.

### Folder Layout

```
wacrm/
├─ src/
│  ├─ app/
│  │  ├─ (auth)/              login, signup, forgot-password
│  │  ├─ (dashboard)/         inbox, contacts, pipelines, broadcasts, automations, settings
│  │  ├─ api/                 webhook, send, broadcast, automations, v1 public API
│  │  └─ page.tsx             marketing landing
│  ├─ components/             UI by module (inbox/, contacts/, etc.)
│  ├─ hooks/                  use-auth, use-realtime
│  ├─ lib/
│  │  ├─ supabase/            client, server, middleware
│  │  ├─ whatsapp/            Meta API, encryption, phone utils
│  │  ├─ automations/         engine, steps, validation
│  │  └─ rate-limit.ts
│  └─ middleware.ts           session refresh
├─ supabase/migrations/       idempotent SQL (001–039+)
├─ docs/                      public-api, docker, mcp
├─ mcp-server/                MCP wrapper over public API
└─ docker-compose.yml
```

### Inbound Message Flow

```
Meta Cloud API ──POST──▶ /api/whatsapp/webhook
                           ├─ HMAC-SHA256 signature verify (META_APP_SECRET)
                           ├─ find/create contact + conversation
                           ├─ insert message row
                           ├─ runAutomationsForTrigger(...)
                           └─ 200 OK

Realtime: messages INSERT → Supabase Realtime → inbox UI updates
```

### Outbound Message Flow

```
Composer ──▶ /api/whatsapp/send
              ├─ auth + rate limit (60/min)
              ├─ decrypt access_token
              ├─ Meta API send
              └─ insert message (status: sent)

UI: optimistic temp row → realtime replaces with real row
```

---

## 3. Getting Started (Local)

**Prerequisites:** Node.js 20+, npm

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/wacrm.git
cd wacrm

# 2. Install
npm install

# 3. Environment
cp .env.local.example .env.local
# Fill Supabase keys (minimum to start dev server)

# 4. Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste into ENCRYPTION_KEY

# 5. Run
npm run dev
# → http://localhost:3000
```

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (Turbopack HMR) on `:3000` |
| `npm run build` | Production build |
| `npm start` | Run production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Vitest |

**First login:** Sign up at `/signup` → land on `/dashboard`. Modules are empty until WhatsApp is connected.

---

## 4. Supabase Setup

One Supabase project per deployment.

### Steps

1. Create project at [supabase.com](https://supabase.com) — save DB password.
2. Copy keys from **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon/public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (**secret — never commit**)
3. **Run migrations** from `supabase/migrations/` in numeric order.

### Migration Options

**Option A — SQL Editor (quickest):** Paste each file in order into Supabase SQL Editor.

**Option B — Supabase CLI:**
```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### Verify

Table Editor should show: `profiles`, `contacts`, `conversations`, `messages`, `pipelines`, `broadcasts`, `automations`, `whatsapp_config`, etc.

### Auth Settings

- **Authentication → Providers:** Email enabled; confirm email ON for production, OFF for local testing.
- **Authentication → URL Configuration:** Add production URL for password-reset links.

### Storage

Optional for default install — media is relayed from Meta on demand. Avatar storage uses Supabase Storage (migration `008`).

> **After updates:** Always apply new migration files before restarting the app. Skipping migrations is the #1 cause of post-update 500 errors.

---

## 5. WhatsApp / Meta Setup

### Prerequisites

- Meta for Developers account
- Meta Business Manager account
- Phone number **not** on regular WhatsApp/WhatsApp Business app (landlines OK)

### Create Meta App

1. My Apps → Create App → **Business** type
2. Add product: **WhatsApp**
3. Connect Business Manager

Meta provides a **test number** for development. Production requires your own number under **WhatsApp → API Setup → From**.

### Collect Credentials

| Meta Value | wacrm Field |
|------------|-------------|
| Phone number ID | Settings → WhatsApp → `phone_number_id` |
| WhatsApp Business ID | `waba_id` (optional) |
| Access token | `access_token` |

**Production token:** Create a **System User** (Business Settings → Users → System users):
- Name: `wacrm-system-user`, role Admin
- Generate token with scopes: `whatsapp_business_management`, `whatsapp_business_messaging`
- Copy immediately — shown once

### Connect in App

1. Settings → WhatsApp
2. Enter Phone number ID, WABA ID, Access token, Verify token (any random string)
3. Save — tokens encrypted with `ENCRYPTION_KEY` before DB write

### Webhook Configuration

**Meta → WhatsApp → Configuration → Webhook:**

| Setting | Value |
|---------|-------|
| Callback URL (local) | `https://<ngrok>.ngrok.app/api/whatsapp/webhook` |
| Callback URL (prod) | `https://<domain>/api/whatsapp/webhook` |
| Verify token | Same string saved in app |

**Subscribe to events (minimum):**
- `messages`
- `message_template_status_update`
- `message_template_quality_update`
- `message_template_components_update`

### Signature Verification (Required)

Set `META_APP_SECRET` from Meta → App Settings → Basic. Without it, **every inbound webhook POST returns 401**.

### Test

Send test message from Meta API Setup → watch Inbox → reply from app.

---

## 6. Environment Variables

All config in `.env.local` (dev) or host env panel (production).

### Required

| Variable | Source | Notes |
|----------|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API settings | Public, baked into client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API settings | Public, RLS-protected |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API settings | Secret — webhook/admin only |
| `ENCRYPTION_KEY` | Generate 64 hex chars | **Never rotate** after deploy |
| `META_APP_SECRET` | Meta App Settings → Basic | Webhook HMAC verification |

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Recommended

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SITE_URL` | Canonical URL (`https://crm.example.com`) — sitemap, OG, reset links |
| `NEXT_PUBLIC_APP_LOCALE` | Default locale (e.g. `en`) |

### Optional

| Variable | Purpose |
|----------|---------|
| `AUTOMATION_CRON_SECRET` | Protects `GET /api/automations/cron`, `/api/flows/cron`, `/api/shopify/notifications/cron`, `/api/whatsapp/broadcast/cron`, and `/api/voice/cron` |
| `META_APP_ID` | Required for image-header message templates |
| `AI_REQUEST_TIMEOUT_MS` | AI call timeout (default `30000`) |
| `AI_CONTEXT_MESSAGE_LIMIT` | Messages sent to AI (default `20`) |

> AI provider keys are stored **in-app** (Settings → AI Assistant), encrypted — not env vars.

### Sample `.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
META_APP_SECRET=abcdef0123456789...
META_APP_ID=1234567890
ENCRYPTION_KEY=3f9c0a7e4d8b2f1a6c5e8d4b9f0a2c6e8d4b9f0a2c6e8d4b9f0a2c6e8d4b9f0a
NEXT_PUBLIC_SITE_URL=https://crm.example.com
AUTOMATION_CRON_SECRET=generate-a-long-random-string
```

---

## 7. Deployment

### Hostinger (Recommended)

1. Buy Managed Node.js plan (2 GB+ RAM for build)
2. hPanel → Websites → Node.js app
   - Node 20+
   - Start command: `npm start`
3. Connect GitHub fork → branch `main`
4. **Set env vars BEFORE build** (`NEXT_PUBLIC_*` baked at build time)
5. `npm ci && npm run build`
6. Restart app
7. Update Meta webhook to production URL
8. Schedule automations cron (see [§12](#12-automations-cron))

**Updates:** Git pull → `npm ci` → `npm run build` → restart. Apply new SQL migrations first if schema changed.

### Other Hosts

Works anywhere Node.js runs: Vercel, Railway, VPS, Docker.

---

## 8. Core Features

### Inbox
Shared WhatsApp conversation workspace — real-time threads, templates, reactions, quote-replies.

### Contacts
Address book with manual add, CSV import, tags, custom fields, deduplication.

### Pipelines
Kanban deal boards — drag-drop stages, multi-pipeline, win-rate analytics.

### Templates
Create/submit/edit/delete WhatsApp message templates in-app; real-time Meta approval status.

### Broadcasts
4-step wizard — bulk-send approved templates with per-recipient delivery tracking.

### Automations
Event-driven step chains: keyword auto-replies, lead routing, tag reactions, webhooks, **Wait** steps (requires cron).

### Flows
Branching button-driven chatbots with human handoff. Cron: `GET /api/flows/cron`.

### AI Assistant
- **Draft replies:** ✨ button in composer (agent-initiated)
- **Auto-reply bot:** Fallback when no Flow/Automation handles message
- **Knowledge base:** FAQs/policies — keyword (Postgres FTS) + optional semantic (pgvector)

**Precedence:** Flows → Automations → AI auto-reply

**Required migrations:** `029_ai_reply.sql`, `030_ai_knowledge.sql`

### Settings
Profile, password, WhatsApp connection, tags, default currency, theme, API keys, AI config.

### Members
Team invites, role-based access (owner/admin/agent/viewer), ownership transfer.

---

## 9. Public REST API (`/api/v1`)

Drive wacrm from scripts without the dashboard UI.

### Authentication

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Create keys: **Settings → API keys** (admin/owner only). Full key shown **once** — stored as SHA-256 hash.

### Scopes

| Scope | Allows |
|-------|--------|
| `messages:send` | Send WhatsApp messages |
| `messages:read` | Read messages + delivery status |
| `contacts:read` / `contacts:write` | List/read/create/update contacts |
| `conversations:read` | List/read conversations |
| `broadcasts:send` | Launch broadcasts |
| `webhooks:manage` | Register outbound webhooks |

### Response Envelope

```json
{ "data": { ... } }           // success
{ "error": { "code": "...", "message": "..." } }  // failure
```

| Status | Code | Meaning |
|--------|------|---------|
| 401 | `unauthorized` | Bad/missing/revoked key |
| 403 | `forbidden` | Missing scope |
| 429 | `rate_limited` | 120 req/min per key |

### Key Endpoints

| Method | Path | Scope | Notes |
|--------|------|-------|-------|
| GET | `/api/v1/me` | (any valid key) | Account + scopes |
| POST | `/api/v1/messages` | `messages:send` | E.164 `to`, types: text/template/media |
| GET | `/api/v1/contacts` | `contacts:read` | Paginated, `?search=`, `?tag=` |
| POST | `/api/v1/contacts` | `contacts:write` | Find-or-create by phone |
| GET/PATCH | `/api/v1/contacts/{id}` | read/write | |
| GET | `/api/v1/conversations` | `conversations:read` | `?status=`, `?contact_id=` |
| GET | `/api/v1/conversations/{id}/messages` | `messages:read` | |
| POST | `/api/v1/broadcasts` | `broadcasts:send` | Max 1000 recipients/request |
| GET | `/api/v1/broadcasts/{id}` | `broadcasts:send` | Poll progress |

### Outbound Webhooks

Register with `POST /api/v1/webhooks` (requires migration `028`).

**Events:** `message.received`, `message.status_updated`, `conversation.created`

Verify signature: `X-Wacrm-Signature: t=<unix>,v1=<hex>` where  
`v1 = HMAC-SHA256(secret, "${t}.${rawBody}")`

---

## 10. MCP Server

Published as [`wacrm-mcp`](https://www.npmjs.com/package/wacrm-mcp) — thin wrapper over public API.

### Cursor / Claude Desktop Config

```jsonc
{
  "mcpServers": {
    "wacrm": {
      "command": "npx",
      "args": ["-y", "wacrm-mcp"],
      "env": {
        "WACRM_BASE_URL": "https://crm.example.com",
        "WACRM_API_KEY": "wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

**Read-only by default.** Opt-in writes:
- `"WACRM_ENABLE_WRITES": "true"` — send messages, create/update contacts
- `"WACRM_ENABLE_BROADCASTS": "true"` — launch broadcasts (destructive)

---

## 11. Docker

```bash
cp .env.local.example .env.local
# fill in values

docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml up --build -d
# → http://localhost:3000
```

| Note | Detail |
|------|--------|
| `HOST_PORT` | Change published port (not `PORT`) |
| `NEXT_PUBLIC_*` | Build-time — rebuild after changes |
| Other secrets | Runtime via Coolify UI / `.env.local` overlay |
| Migrations | **Not** run by container — apply via Supabase CLI/SQL Editor |
| Media storage | Inbound attachments copied to `chat-media` bucket (Meta deletes after ~30 days) |
| Cron | External scheduler required for Wait steps + Flows |

---

## 12. Automations Cron

Wait steps and some automation logic require a periodic drain.

```bash
# Every minute
curl -s -H "x-cron-secret: <AUTOMATION_CRON_SECRET>" \
  https://<domain>/api/automations/cron
```

**Hostinger cron example:**
```
* * * * * curl -s -H "x-cron-secret: <secret>" https://<domain>/api/automations/cron > /dev/null
```

Also schedule `GET /api/flows/cron` if using Flows,
`GET /api/shopify/notifications/cron` if using delayed Shopify
templates (abandoned checkout / after delivered),
`GET /api/whatsapp/broadcast/cron` if using scheduled broadcasts
(one due campaign per minute tick), and `GET /api/voice/cron`
every 10–30s if inbound voice notes should be transcribed and
answered off the webhook request.

Returns `503` until `AUTOMATION_CRON_SECRET` is set.

---

## 13. Security Model

| Mechanism | Detail |
|-----------|--------|
| **RLS** | Every table — users see only their account's rows via `auth.uid()` |
| **Encryption** | AES-256-GCM for WhatsApp tokens + AI keys at rest |
| **Webhook HMAC** | `X-Hub-Signature-256` with `META_APP_SECRET` — fail-closed |
| **Cron secret** | Constant-time compare on `x-cron-secret` header |
| **Rate limiting** | Per-user token bucket (in-memory; swap Redis at scale) |
| **HTTP headers** | HSTS, nosniff, X-Frame-Options, CSP (report-only) |
| **API keys** | SHA-256 hashed, scoped, revocable |

---

## 14. Database Migrations

39 migration files in `supabase/migrations/` (001–039). Apply **in numeric order**.

| Range | Notable additions |
|-------|-------------------|
| 001 | Initial schema |
| 006–007 | Automations |
| 010–012 | Flows |
| 017–020 | Account sharing / team members |
| 026 | API keys |
| 028 | Webhook endpoints |
| 029–030 | AI reply + knowledge base (pgvector) |
| 039 | Inbound media mirror |

---

## 15. Troubleshooting

### Build

| Error | Fix |
|-------|-----|
| `ENCRYPTION_KEY must be 64 hex chars` | Generate and set 64-char hex key |
| `supabaseUrl is required` | Set `NEXT_PUBLIC_SUPABASE_*` before build |

### Auth

| Issue | Fix |
|-------|-----|
| Confirmation email never arrives | Configure SMTP or disable confirm email for testing |
| Reset links point to localhost | Set `NEXT_PUBLIC_SITE_URL` + Supabase redirect URLs |

### WhatsApp

| Issue | Fix |
|-------|-----|
| Webhook verification fails | Match verify token; URL must be public; test with curl GET |
| Outbound works, no inbound | Subscribe to `messages`; check testers whitelist; check logs |
| `Token decryption failed` | `ENCRYPTION_KEY` changed — reconnect WhatsApp in Settings |
| Duplicate `phone_number_id` | Delete duplicate rows; apply migration 013 |

### Deploy

| Issue | Fix |
|-------|-----|
| 502 / app not running | Check logs for missing env vars; confirm `npm run build` ran |
| Env changes don't affect browser | Rebuild — `NEXT_PUBLIC_*` is build-time |
| Webhook stops after domain change | Wait for AutoSSL; re-verify in Meta |

### Automations

| Issue | Fix |
|-------|-----|
| Wait steps never resume | Schedule cron drain |
| Automation fires twice | Multiple instances sharing one Supabase — consolidate deploys |

---

## 16. Useful Commands

```bash
# Dev
npm run dev

# Production build
npm run build && npm start

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Local webhook tunnel
npx ngrok http 3000

# Test webhook verify
curl 'https://crm.example.com/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test'

# Test automations cron
curl -s -H "x-cron-secret: SECRET" https://crm.example.com/api/automations/cron

# Test scheduled-broadcast drain
curl -s -H "x-cron-secret: SECRET" https://crm.example.com/api/whatsapp/broadcast/cron

# Docker
docker compose --env-file .env.local -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

---

## 17. Where to Change Things

| Goal | Location |
|------|----------|
| Marketing / landing page | `src/app/page.tsx`, `src/components/landing/*` |
| Dashboard metrics | `src/lib/dashboard/queries.ts`, `src/components/dashboard/*` |
| Inbox behavior | `src/app/(dashboard)/inbox/`, `src/components/inbox/*` |
| Automation logic | `src/lib/automations/engine.ts`, `steps-tree.ts` |
| New DB column | `supabase/migrations/NNN_*.sql` + `src/types/*.ts` |
| Auth provider | `src/lib/supabase/`, `src/hooks/use-auth.tsx`, `middleware.ts` |
| New API route | `src/app/api/*/route.ts` |
| Rate limits | `src/lib/rate-limit.ts` |

---

## External Links

- **Repo:** https://github.com/ArnasDon/wacrm
- **Docs site:** https://wacrm.tech/docs
- **Marketing site source:** https://github.com/ArnasDon/wacrm-site
- **Issues:** https://github.com/ArnasDon/wacrm/issues
- **MCP npm:** https://www.npmjs.com/package/wacrm-mcp

---

*This study guide was generated from official wacrm documentation. For the latest details, always refer to [wacrm.tech/docs](https://wacrm.tech/docs).*
