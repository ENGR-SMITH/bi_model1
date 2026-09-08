# DEPLOYMENT.md — Production deployment plan (Render + friends)

This is the end-to-end plan for running the whole product in production. It
covers **what** has to run, **which platforms** provide each piece, and the
**step-by-step** sequence to go from this repo to a live, money-making app.

> Read first: `PRODUCTION-ENV.md` (every env var and where to get it) and
> `CREDENTIALS.md` (step-by-step credential hunting). This document assumes
> those values; it focuses on *where things run* and *how they fit together*.

---

## 1. What this product actually is (the deployable units)

The repo is a **pnpm monorepo** with one API server and **four** web apps, plus
optional video workers and a desktop agent. Everything you deploy comes from
`artifacts/*`:

| Unit | Source | What it is | Needs at runtime |
|------|--------|------------|------------------|
| **API server** | `artifacts/api-server` | Express 5 REST API + Socket.IO realtime + Clerk auth + Paystack webhooks + video job queue + Oracle admin backend | Node 24, Postgres, **ffmpeg/ffprobe** for real video, R2, optional Redis |
| **Tandem** | `artifacts/tandem` | Main hub SPA, served at `/` | Static files only |
| **Author Den** | `artifacts/authors-den` | Writing studio SPA, served at `/authors-den/` | Static files only |
| **Creator Den** | `artifacts/creators-den` | Video platform SPA, served at `/creators-den/` | Static files only |
| **Oracle Admin** | `artifacts/oracle-admin` | Private control room SPA, served at `/oracle-admin/` | Static files only |
| **Video workers** *(optional)* | `artifacts/api-server` (`dist/workers/*`) | BullMQ worker fleet for heavy transcoding | Node 24, ffmpeg, Redis, R2 |
| **Desktop agent** *(optional)* | `artifacts/desktop-agent` | Electron installer for large uploads | Distributed via R2 / GitHub Actions |

### The one thing that decides your topology: same-origin API calls

The web apps call the API with **relative paths** (`/api/...`) and open
Socket.IO on the **same origin** (`/socket.io` by default). Nothing in the
frontends points at a remote API URL — `customFetch` prepends nothing unless
`setBaseUrl()` is called, and it isn't in the web apps.

That means production needs a **router** that serves the four SPAs and forwards
`/api` + `/socket.io` to the API server, all under one domain. This is exactly
what the Vite configs describe ("mirror the production router, which sends
`/api` to the API server, `/authors-den` to the Author Den app, and everything
else to this app").

**Topology at a glance:**

```
                          ┌──────────────────────────────┐
                          │  app.yourdomain.com          │
                          │  (Render web service — the  │
                          │   one-container router)     │
                          │                              │
   / ..................→  │  Tandem build (static)       │
   /authors-den/ ......→ │  Author Den build (static)    │
   /creators-den/ .....→ │  Creator Den build (static)   │
   /oracle-admin/ .....→ │  Oracle Admin build (static)  │
   /api/* .............→ │  ──proxy──► API server :3000  │
   /socket.io .........→ │  ──proxy──► API server :3000  │
                          └──────────────┬───────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
        Supabase Postgres          Cloudflare R2              Clerk / Paystack
        (DATABASE_URL)             (video files)              (auth / payments)
```

---

## 2. The platform list — every service you need

### Required (core)

| # | Platform | What it provides | Why here |
|---|----------|------------------|----------|
| 1 | **Supabase** | Postgres database (`DATABASE_URL`) | All app data: subscriptions, promos, users, projects, video jobs, provider keys. Chosen by you; the app just needs a Postgres connection string. |
| 2 | **Render** — the app host | One Docker container running nginx (the 4 SPAs + router) **and** the Node API server together, under one origin | Runs the Express API + Socket.IO + the in-process video worker, with ffmpeg installed. Render has **no request-body cap** (unlike Cloud Run's 32 MiB), so the browser upload path (multer, up to the UI's 500 MB cap) works as-is. Paid instance types support WebSockets. `Standard` (2 GB / 1 CPU, $25/mo) is the right size. |
| 3 | **Cloudflare R2** | S3-compatible object storage, zero egress | Video proxies, renders, exports, bundles, thumbnails. Already fully integrated (presigned URLs + AWS SDK). Supabase Storage could replace it later (also S3-compatible) but the code is wired for R2 today. |
| 4 | **Clerk** | Authentication + admin magic links | Already integrated in every app. Provides the email the Oracle Admin magic-link login runs on — no SMTP provider needed. |
| 5 | **Paystack** | USD card payments + webhooks | All paid entitlements (subscriptions, tickets, storage). Webhook URL must point at your API server. |
| 6 | **Domain: registrar (Porkbun / Cloudflare Registrar) + Cloudflare DNS** | `app.yourdomain.com` | Everything hangs off one public origin. Register cheaply (Porkbun) or at cost (Cloudflare Registrar, same account as R2); keep DNS at Cloudflare. One `CNAME app →` your Render URL handles the rest; Render issues the TLS certificate. |
| 7 | **GitHub Actions** | CI/CD for the desktop agent | Two workflows already exist (`build-desktop-agent.yml`, `desktop-agent-windows.yml`). The web app + API deploy needs no workflow — Render deploys straight from the git repo. |

### Optional (only for heavy video / bigger loads)

| # | Platform | What it provides | When you need it |
|---|----------|------------------|------------------|
| 9 | **Upstash Redis** (or Redis Cloud) | `REDIS_URL` for BullMQ | When video volume outgrows the in-process polling loop (`worker.ts`): Redis turns BullMQ into the claim layer and lets you run a separate worker fleet with `pnpm run workers`. Without it, the API server processes jobs in-process — fine for small loads. **Until Redis is in, keep the Render service at exactly 1 instance** — a second instance would run a second poller and duplicate jobs (see §3). |
| 10 | **faster-whisper** (Python) | Real transcription | The API server runs `faster_whisper` via Python for real transcripts. Without it, transcripts are clearly-marked **demo** placeholders. If you need real transcription, the API image must also ship Python + `faster-whisper`. |

> **What you do *not* need:** an email provider (Clerk sends the magic links),
> a separate CDN (R2 + your static host handle it), a load balancer at launch
> (Render handles TLS + routing), or Supabase Auth/Realtime (Clerk does auth;
> Socket.IO does realtime).

---

## 3. The hosting decision — Render, one container, one origin

**One Render web service runs everything.** The container has two processes:

- **nginx** — serves the 4 built SPAs at their base paths (`/`,
  `/authors-den/`, `/creators-den/`, `/oracle-admin/`) with SPA fallback, and
  reverse-proxies `/api` + `/socket.io` to the Node server inside the same
  container.
- **Node API server** — Express + Socket.IO + video worker, with ffmpeg
  installed in the image.

Both live behind one public origin (`https://app.yourdomain.com`), which is
exactly what the frontends expect (relative `/api` calls, same-origin
sockets). No CORS surprises, no `VITE_SOCKET_URL`, no separate static hosts.

**Why Render specifically (vs. the alternatives):**

- **No request-body cap.** Cloud Run hard-limits HTTP/1 requests to 32 MiB —
  that would break the app's browser uploads (multer allows 10 GB; the UI
  supports browser uploads up to 500 MB before steering people to the desktop
  agent). Render has no such limit, so **zero code changes are needed for
  uploads**.
- **Always-on by design.** The in-process video worker and Socket.IO need a
  process that never sleeps. Render's free tier spins down after 15 min of
  inactivity — unusable here — but any paid instance type runs 24/7.
  `Standard` (2 GB / 1 CPU, $25/mo) is the right size; it also supports
  WebSockets and autoscaling.
- **Push-to-deploy from GitHub** — no CI workflow to write for the container.
- Managed TLS + custom domains at no extra cost.

**Cost:** `Standard` = **$25/mo** flat (2 GB RAM, 1 CPU). Optional Render Disk
for upload staging is $0.25/GB/mo. No per-request or per-CPU-second surprises
the way Cloud Run's always-on min-instance billing has (~$70/mo for the same
spec).

**The one setting that matters:** **instance count = 1**. The no-Redis mode
runs the video worker as an in-process `setInterval` poller with **no
cross-instance claim lock** — if a second instance ever starts, both pollers
can grab the same `QUEUED` jobs (double transcodes, duplicate R2 writes) and
Socket.IO presence splits across instances. Keep 1 instance until you add
Redis/BullMQ (then you can autoscale the API and run a separate worker fleet).

**Alternatives considered and rejected:**

| Host | Why not |
|------|---------|
| **Cloud Run** | 32 MiB request cap breaks browser video uploads (would need presigned R2 upload code); ~$70/mo for a min-1 1 vCPU/2 GiB instance; in-process worker requires `--max-instances 1` |
| **Railway** | Works (no caps, WebSockets), but usage-based billing penalizes an always-on box — ~$40/mo for 1 vCPU/2 GiB vs Render's flat $25 |
| **Hetzner VPS + Caddy** | Cheapest (~$5–10/mo, 4 vCPU/8 GB, no limits) — right pick if you want to own OS updates, Docker upgrades, and backups yourself. Keep as the fallback if Render costs become a problem |

If you ever outgrow one container, scale the API and the nginx router into two
Render services behind the same domain — but only after Redis is in.

---

## 4. The step-by-step deployment plan

### Phase 0 — Prereqs

- [ ] Repo pushed to GitHub (`ENGR-SMITH/bi_model1`)
- [ ] A domain you control (or a subdomain like `app.yourdomain.com`)
- [ ] Accounts: Supabase, Cloudflare, Clerk, Paystack, Render

### Phase 1 — Supabase (the database)

1. **Create a project** at https://supabase.com → New project → name it (e.g.
   `tandem`), pick a region near your users. Free tier is fine to start.
2. **Get the connection string:** Project Settings → **Database** → Connection
   string → *URI* (the `postgresql://postgres.<ref>:<password>@aws-...pooler.supabase.com:5432/postgres`
   one). Use the **Session pooler** string for the API server.
3. **Push the schema.** From the repo root (needs `DATABASE_URL` pointing at
   Supabase):
   ```bash
   DATABASE_URL='postgresql://...' pnpm --filter db run push-force
   ```
   > Alternative (no drizzle-kit on the box): apply the SQL migrations in
   > `lib/db/migrations/*.sql` in order via the Supabase **SQL Editor** or
   > `psql "$DATABASE_URL" -f lib/db/migrations/0012_paystack_plans.sql` etc.
4. **Verify:** `\dt` shows tables like `tandem_subscriptions`,
   `tandem_paystack_plans`, `tandem_promo_codes`, `tandem_video_jobs`.

> Note: Supabase's own auth/storage/realtime features are **not** used — you
> only consume it as a Postgres server. Do not enable RLS or touch its auth
> tables; the app manages its own rows.

### Phase 2 — Build the artifacts (in CI or locally)

Each Vite app requires `PORT` + `BASE_PATH` at **build** time (the configs
throw without them) and `VITE_CLERK_PUBLISHABLE_KEY` baked in. Oracle Admin
reads `CLERK_PUBLISHABLE_KEY` from the **repo-root `.env`** via `envDir` — so
the build environment must have that root `.env` populated too.

```bash
# API server bundle (dist/index.mjs + workers)
pnpm --filter @workspace/api-server run build

# The four SPAs (dist/public each)
PORT=3001 BASE_PATH=/                 pnpm --filter @workspace/tandem build
PORT=3002 BASE_PATH=/authors-den/     pnpm --filter @workspace/authors-den build
PORT=3003 BASE_PATH=/creators-den/    pnpm --filter @workspace/creators-den build
PORT=3004 BASE_PATH=/oracle-admin/    pnpm --filter @workspace/oracle-admin build
```

When deploying via the Docker image (§4), these build-time values are supplied
inside the Dockerfile (see §7) — the only build-time keys you must provide
are the Clerk ones:

| Env var | For which build |
|---------|-----------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | tandem, authors-den, creators-den (their own `.env` or CI env) |
| `CLERK_PUBLISHABLE_KEY` (root `.env`) | oracle-admin (reads it via `envDir`) |
| `BASE_PATH`, `PORT` | all four (hardcoded in the Dockerfile — they shape the build, not the server) |

### Phase 3 — Build the one-container image

1. **Dockerfile** (`artifacts/api-server/Dockerfile`, full example in §7):
   base image `node:24-bookworm-slim`, `apt-get install ffmpeg nginx`, copy
   the repo, `pnpm install --frozen-lockfile`, build the API bundle and the
   four SPAs (Clerk keys passed as `ARG`s), copy the SPAs into the nginx
   docroots, and start both processes via `entrypoint.sh`.
2. **nginx.conf** (`artifacts/api-server/nginx.conf`) — the router config from
   §1: serve the four SPAs with fallback, proxy `/api` + `/socket.io` to
   `127.0.0.1:3000`.
3. **entrypoint.sh** (`artifacts/api-server/entrypoint.sh`):
   ```bash
   #!/bin/sh
   # The bundle lives at artifacts/api-server/dist/index.mjs (esbuild writes
   # into the package dir; pnpm runs the build with that package as cwd).
   set -e
   PORT=3000 node --enable-source-maps ./artifacts/api-server/dist/index.mjs &   # API on :3000
   nginx -g 'daemon off;'                                                            # router in foreground
   ```

### Phase 4 — Deploy to Render

1. **Create the service:** Render dashboard → **New → Web Service** → connect
   the GitHub repo.
2. **Configure:**
   - Name: `tandem` (this becomes `<service>.onrender.com`).
   - **Dockerfile Path:** `artifacts/api-server/Dockerfile` (leave **Root
     Directory** at the repo root — the repo root is the build context, so
     the `COPY . .` / `COPY artifacts/...` lines in §7 work, and the
     repo-root `.dockerignore` applies).
   - **Environment:** `Docker`.
   - **Plan:** `Standard` (2 GB / 1 CPU). Do **not** use the free tier — it
     sleeps, killing Socket.IO and the in-process video worker.
   - **Instance count:** 1 (never more until Redis is in — see §3).
   - **Health check path:** `/api/healthz`.
3. **Set env vars** (all of Phase-5's list) in **Settings → Environment**.
   Render auto-translates service env vars into Docker **build args**, so the
   two public Clerk keys (`VITE_CLERK_PUBLISHABLE_KEY`,
   `CLERK_PUBLISHABLE_KEY`) declared as `ARG`s in the Dockerfile arrive
   automatically. Secret keys are runtime-only — never set them as build
   args.
4. **Deploy:** push to `main` (or hit **Manual Deploy** the first time). Render
   builds the image and starts it.
5. **Custom domain:** Settings → **Custom Domains** → add
   `app.yourdomain.com` → point the DNS `CNAME` at
   `<service>.onrender.com` → Render issues and renews the TLS certificate
   automatically.

> Whatever you choose: **one public origin**, path-based routing, SPA
> fallback, and `/api` + `/socket.io` forwarded to the API server.

### Phase 5 — Environment variables (API server)

Copy from `PRODUCTION-ENV.md`. The fail-closed list:

```env
NODE_ENV=production
PORT=8080                              # Render's default injected port is 10000;
                                       # set 8080 so nginx can listen on it. The
                                       # entrypoint runs Node itself on 3000.
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CORS_ORIGINS=https://app.yourdomain.com        # all origins that call the API
ADMIN_EMAIL=you@yourdomain.com
SESSION_SECRET=<openssl rand -hex 32>
PAYSTACK_SECRET_KEY=sk_live_...

# Storage (video) — optional but recommended
CF_ACCOUNT_ID=...
CF_R2_BUCKET=tandem-media
CF_R2_ACCESS_KEY=...
CF_R2_SECRET_KEY=...

# Upload staging — optional
# Render's container filesystem is writable but ephemeral (reset on redeploy).
# The worker restores originals from R2 after restarts, so the default
# .uploads/video works, but a persistent Render Disk mounted at /data/uploads
# with VIDEO_UPLOAD_DIR=/data/uploads avoids re-uploading/re-staging big files.

# Optional: real transcription / AI
# (GROQ_API_KEY / OPENROUTER_API_KEY / FREEBUFF_API_KEY…)
```

> The server **refuses to boot in production** without `CORS_ORIGINS`,
> `ADMIN_EMAIL`, a strong `SESSION_SECRET`, and `CLERK_SECRET_KEY` — a bad
> deploy fails loudly, not silently.

### Phase 6 — Wire up the third parties

1. **Clerk** (dashboard):
   - Switch the app to **Production** instance; put the `pk_live_`/`sk_live_`
     keys in the API env + the frontend builds.
   - **Redirect URLs**: add `https://app.yourdomain.com` and
     `https://app.yourdomain.com/oracle-admin/verify` (and the
     `/sign-in`, `/sign-up` paths).
   - **Email verification link** enabled, and **"Require the same device and
     browser" turned OFF** (magic links must work from any browser).
2. **Paystack** (dashboard → Settings → API Keys & Webhooks):
   - Webhook URL → `https://<api-host>/api/paystack/webhook` (Test *and* Live).
   - Live keys only after business activation; **USD settlement** (international
     payments + Zenith USD account) or USD charges fail.
3. **Cloudflare R2**: bucket + API token (Object Read & Write) → the four
   `CF_*` vars above. Public bucket URL → `VITE_AGENT_DOWNLOAD_URL` if you ship
   the desktop agent.
4. **DNS + domain**: see the Domain section below — register the domain,
   put DNS at Cloudflare, and add a `CNAME app →` your Render service URL, then
   add the custom domain in the Render dashboard.

### Phase 7 — Launch checklist

- [ ] `https://app.yourdomain.com/api/healthz` returns 200
- [ ] Sign in with Clerk on Tandem works (production keys)
- [ ] Author Den reachable at `/authors-den/`, Creator Den at `/creators-den/`,
      Oracle Admin at `/oracle-admin/` — and deep links refresh without 404
- [ ] Socket.IO connects (presence roster / job progress updates live)
- [ ] A **large browser upload (e.g. 200 MB) succeeds** — no request-body cap
      on Render (this would have failed on Cloud Run's 32 MiB limit)
- [ ] Oracle Admin: magic-link login with `ADMIN_EMAIL`, provider keys save
- [ ] Test-mode Paystack checkout completes → subscription row created, webhook
      grants entitlement, auto-renew plan exists on Paystack
- [ ] A video upload produces a real ffmpeg proxy (log shows `demo: false`)
- [ ] DB rows visible in Supabase (subscriptions, video jobs, promo codes)

---

## 5. Domain & DNS

1. **Register** the domain at **Porkbun** (cheapest renewals, free WHOIS
   privacy) or **Cloudflare Registrar** (at-cost, and it keeps everything in
   the account you already have for R2).
2. **Put DNS at Cloudflare** (free): add the domain to a Cloudflare zone, then
   change your registrar's nameservers to the two Cloudflare ones.
3. **Add a DNS record** pointing at Render:
   `CNAME  app  →  <your-service>.onrender.com`.
4. **Map the custom domain in Render:** open the service → **Settings →
   Custom Domains** → add `app.yourdomain.com` → Render verifies the CNAME and
   issues a free managed TLS certificate automatically.
5. **Done:** `https://app.yourdomain.com` is the one origin — Tandem at `/`,
   Author Den at `/authors-den/`, Creator Den at `/creators-den/`, Oracle
   Admin at `/oracle-admin/`, API at `/api`.
6. **Remember to update Clerk redirect URLs** (`https://app.yourdomain.com`
   and `/oracle-admin/verify`) and **Paystack webhook**
   (`https://app.yourdomain.com/api/paystack/webhook`) once the domain is live.

---

## 6. Ongoing operations

| When | Do |
|------|-----|
| Schema changes | Run `DATABASE_URL=... pnpm --filter db run push-force` (or apply the new SQL migration) **before** deploying the new API server |
| Code changes | Push to `main` → Render rebuilds and redeploys the container automatically |
| Backups | Supabase handles Postgres backups (PITR on paid plans). R2: enable bucket versioning. If you use a Render Disk for uploads, snapshot it or rely on R2 as the durable copy |
| Scaling | Keep **1 instance** until Redis is in. Then: add Upstash Redis (`REDIS_URL`) → BullMQ mode auto-enables → you may autoscale the API and run `pnpm run workers` as a separate fleet for heavy transcodes |
| Secrets | Keep everything in Render's environment manager, never in git (`.env` is git-ignored) |

---

## 7. Reference: the one-container Dockerfile (nginx + API)

```dockerfile
# artifacts/api-server/Dockerfile (committed to the repo)
FROM node:24-bookworm-slim

# ffmpeg is required for real video proxies/renders/audio/exports.
# nginx serves the four built SPAs and proxies /api + /socket.io to Node.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nginx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin pnpm explicitly — the root package.json has no "packageManager" field,
# so `corepack enable` alone would not guarantee the pnpm 10 used by CI.
RUN npm install -g pnpm@10

ENV NODE_ENV=production

# Public Clerk keys, baked into the four SPA builds. Render auto-translates
# service env vars into Docker build args, so setting the two keys on the
# service is enough. Never pass secret keys as build args — they would be
# baked into the image; secrets only need to exist at runtime.
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY

# Fail fast: a build without Clerk keys produces apps that cannot sign in.
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" && test -n "$CLERK_PUBLISHABLE_KEY" \
    || { echo "ERROR: VITE_CLERK_PUBLISHABLE_KEY and CLERK_PUBLISHABLE_KEY build args are required" >&2; exit 1; }

# Full repo context (see the repo-root .dockerignore — node_modules/.git/.env
# excluded). Render's build context is the repo root, so this works with the
# Dockerfile Path set to artifacts/api-server/Dockerfile.
COPY . .

# Workspace-aware install; the whole workspace matches the frozen lockfile.
RUN pnpm install --frozen-lockfile

# Build the API bundle (dist/index.mjs + dist/workers/*).
RUN pnpm --filter @workspace/api-server run build

# Build the four SPAs with their base paths baked in (PORT + BASE_PATH are
# required by each Vite config; the Clerk keys come from the ARG/ENV above).
RUN PORT=3001 BASE_PATH=/               pnpm --filter @workspace/tandem build \
 && PORT=3002 BASE_PATH=/authors-den/   pnpm --filter @workspace/authors-den build \
 && PORT=3003 BASE_PATH=/creators-den/  pnpm --filter @workspace/creators-den build \
 && PORT=3004 BASE_PATH=/oracle-admin/  pnpm --filter @workspace/oracle-admin build

# Ship the built SPAs into the nginx docroots.
RUN mkdir -p /srv/tandem/root /srv/tandem/authors-den /srv/tandem/creators-den /srv/tandem/oracle-admin \
 && cp -r artifacts/tandem/dist/public/.        /srv/tandem/root/ \
 && cp -r artifacts/authors-den/dist/public/.   /srv/tandem/authors-den/ \
 && cp -r artifacts/creators-den/dist/public/.  /srv/tandem/creators-den/ \
 && cp -r artifacts/oracle-admin/dist/public/.  /srv/tandem/oracle-admin/

COPY artifacts/api-server/nginx.conf /etc/nginx/conf.d/default.conf
COPY artifacts/api-server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
CMD ["/entrypoint.sh"]
```

```nginx
# artifacts/api-server/nginx.conf (committed to the repo)
# Installed as /etc/nginx/conf.d/default.conf (inside the http block), so
# http-context directives like `map` are legal here.

# Uploads go straight through to Node (multer allows up to 10 GB; the UI caps
# browser uploads at 500 MB). nginx's default limit is 1 MB — lift it entirely.
client_max_body_size 0;

gzip on;
gzip_types text/plain text/css application/javascript application/json image/svg+xml;
gzip_min_length 1024;

# Allow Socket.IO's WebSocket upgrade while keeping regular requests clean.
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 8080;
  server_name _;
  root /srv/tandem/root;   # Tandem build (BASE_PATH=/)
  index index.html;

  # The three sub-apps must keep their trailing slash (Vite base paths).
  location = /authors-den  { return 301 /authors-den/; }
  location = /creators-den { return 301 /creators-den/; }
  location = /oracle-admin { return 301 /oracle-admin/; }

  # API (REST + Clerk proxy) → Node. Stream large upload bodies straight
  # through instead of buffering them to disk first.
  location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_request_buffering off;
  }

  # Socket.IO realtime → Node (WebSocket upgrade).
  location /socket.io/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # The three sub-apps, each with SPA fallback to its own index.html.
  location /authors-den/  { alias /srv/tandem/authors-den/;  try_files $uri $uri/ /authors-den/index.html; }
  location /creators-den/ { alias /srv/tandem/creators-den/; try_files $uri $uri/ /creators-den/index.html; }
  location /oracle-admin/ { alias /srv/tandem/oracle-admin/; try_files $uri $uri/ /oracle-admin/index.html; }

  # Tandem SPA fallback (everything else).
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

> **Build context:** a repo-root `.dockerignore` (committed) keeps
> `node_modules`, `**/dist`, `.env*`, and `.git` out of the build context —
> required because Render builds from the repo root (root `node_modules` alone
> is ~1.1 GB).

> **Port wiring:** Render injects `PORT=10000` by default, but the service env
> overrides it — set `PORT=8080` so nginx can listen there (the Dockerfile
> `EXPOSE 8080` matches). The entrypoint runs Node on `127.0.0.1:3000`
> explicitly so it never collides with nginx's 8080.
>
> **Uploads:** the container filesystem is writable but ephemeral — uploads
> staged in `VIDEO_UPLOAD_DIR` disappear on redeploy, which is fine because the
> worker already restores originals from R2. For heavy upload volumes, mount a
> Render Disk at `/data/uploads` and set `VIDEO_UPLOAD_DIR=/data/uploads`.
>
> **Long ffmpeg jobs:** they run in the background polling loop, not inside
> request handlers, so no request-timeout problem — but a single `Standard`
> instance (1 CPU) processes jobs one at a time. When that's too slow, that's
> the signal to add Redis + the BullMQ worker fleet.

---

## 8. Supabase-specific notes

- **Use the Session pooler URI** (`...pooler.supabase.com:5432/postgres` with
  `?sslmode=require`) as `DATABASE_URL` — it's built for server workloads.
- **Do not** enable Supabase Auth/Realtime/Storage for this app — Clerk owns
  auth, Socket.IO owns realtime, R2 owns media. You're using Supabase purely as
  Postgres.
- **If you ever want Supabase Storage instead of R2:** Supabase Storage is
  S3-compatible, but the app's object storage layer (`object-storage.ts`) is
  written against the R2 endpoint with presigned URLs — swapping means changing
  the bucket endpoint + credentials there. Not required for launch.
- Supabase free tier sleeps after a week of inactivity — either log in once a
  week or use a paid plan for a production DB.