# Coolify

WACRM’s Docker Compose stack is **nginx + app (PM2: Next.js + BullMQ worker) + Redis**. Coolify does not need a BullMQ plugin. It only has to run `docker-compose.yml` and inject env vars.

`.env.local` is gitignored. The production compose file never reads it.

## Recommended: Docker Compose resource

1. New resource (or change build pack) → **Docker Compose** → this Git repository.
2. Compose file: `docker-compose.yml` at the repo root.
3. Do **not** add `docker-compose.local.yml`. That overlay is laptop-only (`.env.local` + a host port).
4. Do **not** add a separate Coolify Redis database. Redis is already the `redis` service. A second Redis with a different `REDIS_URL` would split the queue.
5. Put secrets in the Coolify **Environment Variables** UI.

### Build-time (must be available when the image builds)

Changing these requires a rebuild, not just a restart. In Coolify mark them as available at **build time**.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` (`https://cloud.vachat.in` in production)
- `NEXT_PUBLIC_APP_LOCALE` (optional, default `en`)
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` (optional, only if checkout uses Razorpay in the browser)

### Runtime (passed through on `app` only)

- `SUPABASE_SERVICE_ROLE_KEY`
- `ENCRYPTION_KEY`
- `META_APP_SECRET`
- `AUTOMATION_CRON_SECRET` (HTTP crons: automations, flows, broadcasts, billing)
- Optional: `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `META_APP_ID`, `ALLOWED_INVITE_HOSTS`, Razorpay secrets

Do **not** set `REDIS_URL` in Coolify. Compose pins `REDIS_URL=redis://redis:6379` on `app`.

Do **not** set `PORT`. Compose pins it to 3000 inside `app`.

### Domain / SSL

Attach the Coolify domain and Let’s Encrypt certificate to the **nginx** service, container port **80**, not `app:3000`.

```
Internet → Coolify Traefik (HTTPS) → nginx:80 → app:3000
                                         ↘ redis (internal)
```

Do not publish host `:80` / `:443` from this compose file. Coolify’s proxy already owns those ports.

PM2 inside `app` runs `wacrm` (HTTP) and `wacrm-worker` (BullMQ).

Liveness is `GET /api/health` (no auth). Compose healthchecks hit that path.

### After the first deploy

In the `app` container:

```bash
pm2 status
```

You should see `wacrm` and `wacrm-worker` online.

```bash
redis-cli -h redis ping
```

Expect `PONG` from the app container (or `redis-cli ping` inside the redis container).

## Migrating an existing Dockerfile / Nixpacks app

The current production Coolify resource may still be a **Dockerfile** pack. That image already starts PM2 (web + worker) but it does **not** start Redis.

Pick one:

**A. Switch the resource to Docker Compose** (recommended). Copy the same env vars into the new resource, mark `NEXT_PUBLIC_*` as build-time, attach `cloud.vachat.in` to **nginx:80**, then deploy. Do not also keep a Coolify Redis database unless you delete the compose `redis` service.

**B. Keep Dockerfile** and add a Coolify **Redis** database on the same Docker network. Set `REDIS_URL` to that instance (include the password if Coolify set one, e.g. `redis://:password@<redis-host>:6379`). Point the Coolify proxy at port **3000**. Skip compose Nginx — Traefik talks to Next.js directly.

Without Redis, chat/voice/call-recording still work via the webhook fallback, but they block Meta’s request again.

## Local vs Coolify compose files

| File | Used by |
|------|---------|
| `docker-compose.yml` | Coolify and production |
| `docker-compose.local.yml` | Laptop only (`.env.local` + host port) |

Coolify must **not** select `docker-compose.local.yml`.
