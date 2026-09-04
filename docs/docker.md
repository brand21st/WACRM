# Running with Docker

The repo ships a multi-stage `Dockerfile` (Next.js standalone output
plus a bundled BullMQ worker, supervised by PM2) and a
`docker-compose.yml` with three services: **nginx**, **app**, and
**redis**. Supabase is external — point the app at your hosted (or
self-hosted) Supabase project via env vars; no database container is
included.

Traffic path: `Internet → Nginx :80 → app :3000` (PM2 runs `wacrm`
and `wacrm-worker`). Redis is internal only.

## Quick start

1. Copy the env template and fill it in:

   ```bash
   cp .env.local.example .env.local
   ```

2. Build and start (the `--env-file` flag is required — Compose only
   reads `.env` by default for `${VAR}` substitution, and this project
   keeps its config in `.env.local`):

   ```bash
   docker compose --env-file .env.local up --build -d
   ```

3. The app is served on [http://localhost:3000](http://localhost:3000)
   through Nginx (publish it elsewhere with `HOST_PORT=8080` in
   `.env.local`). Compose sets `REDIS_URL=redis://redis:6379` on `app`.

> Use `HOST_PORT`, not `PORT`, to move the published port. `PORT` is
> what the Next.js process listens on _inside_ the app container
> (pinned to 3000). Nginx is what binds on the host.

## Process manager (PM2)

The app container PID 1 is `pm2-runtime start ecosystem.config.cjs`:

- `wacrm` — Next.js (`server.js`)
- `wacrm-worker` — BullMQ (`dist/worker.js`)

Do not use `pm2 start` in Docker — it daemonizes and the container
exits. On a VPS or Hostinger Node, set the start command to
`npm run start:pm2` and point `REDIS_URL` at Redis. Hostinger shared
hosting already has its own reverse proxy — skip the compose Nginx
there.

Locally without Docker: `npm run dev` in one terminal and
`npm run worker` in another (requires `REDIS_URL`).

## Build-time vs runtime variables

- `NEXT_PUBLIC_*` variables are **inlined into the client bundle at
  build time**. They are passed as Docker build args by
  `docker-compose.yml`. If you change any of them, rebuild:
  `docker compose --env-file .env.local up --build -d`.
- Everything else (`SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`,
  `META_APP_SECRET`, `REDIS_URL`, …) is read at **runtime** from
  `.env.local` via `env_file` and is never baked into the image —
  safe to change with just a container restart. Compose overwrites
  `REDIS_URL` to the sidecar.

## Plain Docker (no Compose)

You still need a Redis instance. Example:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key \
  -t wacrm .

docker run -d --name wacrm-redis redis:7-alpine redis-server --appendonly yes

docker run -d --env-file .env.local \
  -e PORT=3000 \
  -e REDIS_URL=redis://wacrm-redis:6379 \
  --link wacrm-redis:redis \
  -p 3000:3000 wacrm
```

Without Nginx in front, the container publishes Next.js directly on
3000. Prefer Compose for production.

## Coolify

Point the Coolify domain / SSL proxy at the **nginx** service (port
80), not at `app:3000`. The stack is `nginx` + `app` + `redis`.

## Notes

- Database migrations under `supabase/` are **not** run by the
  container — apply them with the Supabase CLI as described in the
  README.
- Received attachments are copied into the `chat-media` Supabase
  Storage bucket, because Meta deletes media roughly 30 days after it
  arrives and the copy is the only thing that outlives that. It grows
  with inbound volume, so it's worth watching your project's storage
  quota. Turn it off per account under Settings → WhatsApp →
  Attachment Storage; attachments received while it's off become
  unviewable once Meta drops them. Files over 16 MB (the bucket's
  limit) are never copied.
- Chat AI replies, inbound voice STT/TTS, and post-call recording run
  on the BullMQ worker. If Redis is down, the webhook falls back to
  inline processing / `voice_inbound_jobs`.
- Automations, flows, Shopify notifications, broadcasts, and billing
  still use HTTP cron. Point an external scheduler at
  `GET /api/automations/cron`, `GET /api/flows/cron`,
  `GET /api/shopify/notifications/cron`,
  `GET /api/whatsapp/broadcast/cron`, and
  `GET /api/billing/cron`, sending the shared secret in the
  `x-cron-secret` header (`AUTOMATION_CRON_SECRET`, see
  `.env.local.example`). `/api/voice/cron` is an optional fallback if
  Redis is unavailable — it is no longer required when the worker is
  running.
- Nginx config lives in `deploy/nginx/`. The webhook location disables
  proxy buffering so Meta's POST is not held in Nginx while Node
  persists the message. Do not rate-limit `/api/whatsapp/webhook`.
