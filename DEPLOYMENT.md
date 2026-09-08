# DEPLOYMENT.md — Production deployment plan (Supabase + friends)

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
                          │  (reverse proxy / router)    │
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
| 2 | **Google Cloud Run** — the app host | One Docker container running nginx (the 4 SPAs + router) **and** the Node API server together, under one origin | Runs the Express API + Socket.IO + the in-process video worker, with ffmpeg installed. The codebase already contains Cloud Run–specific handling (`clerkProxyMiddleware` buffers chunked Clerk responses "because the deployment edge (Cloud Run) rejects them"), so Cloud Run is the intended target. `--min-instances 1` keeps WebSockets and the video worker alive. |
| 3 | **Cloudflare R2** | S3-compatible object storage, zero egress | Video proxies, renders, exports, bundles, thumbnails. Already fully integrated (presigned URLs + AWS SDK). Supabase Storage could replace it later (also S3-compatible) but the code is wired for R2 today. |
| 4 | **Clerk** | Authentication + admin magic links | Already integrated in every app. Provides the email the Oracle Admin magic-link login runs on — no SMTP provider needed. |
| 5 | **Paystack** | USD card payments + webhooks | All paid entitlements (subscriptions, tickets, storage). Webhook URL must point at your API server. |
| 6 | **Domain: registrar (Porkbun / Cloudflare Registrar) + Cloudflare DNS** | `app.yourdomain.com` | Everything hangs off one public origin. Register cheaply (Porkbun) or at cost (Cloudflare Registrar, same account as R2); keep DNS at Cloudflare. One `CNAME app →` Cloud Run URL and Cloud Run's custom-domain mapping handle the rest. |
| 7 | **GitHub Actions** | CI/CD from this repo | Build + deploy the API container on push. Two workflows for the desktop agent already exist. |

### Optional (only for heavy video / bigger loads)

| # | Platform | What it provides | When you need it |
|---|----------|------------------|------------------|
| 9 | **Upstash Redis** (or Redis Cloud) | `REDIS_URL` for BullMQ | When video volume outgrows the in-process polling loop (`worker.ts`): Redis turns BullMQ into the claim layer and lets you run a separate worker fleet with `pnpm run workers`. Without it, the API server processes jobs in-process — fine for small loads. |
| 10 | **faster-whisper** (Python) | Real transcription | The API server runs `faster_whisper` via Python for real transcripts. Without it, transcripts are clearly-marked **demo** placeholders. If you need real transcription, the API image must also ship Python + `faster-whisper`. |

> **What you do *not* need:** an email provider (Clerk sends the magic links),
> a separate CDN (R2 + your static host handle it), a load balancer at launch
> (Cloud Run / the VM proxy handles TLS + routing), or Supabase Auth/Realtime
> (Clerk does auth; Socket.IO does realtime).

---

## 3. The hosting decision — Google Cloud Run, one container, one origin

**One Cloud Run service runs everything.** The container has two processes:

- **nginx** — serves the 4 built SPAs at their base paths (`/`,
  `/authors-den/`, `/creators-den/`, `/oracle-admin/`) with SPA fallback, and
  reverse-proxies `/api` + `/socket.io` to the Node server inside the same
  container.
- **Node API server** — Express + Socket.IO + video worker, with ffmpeg
  installed in the image.

Both live behind one public origin (`https://app.yourdomain.com`), which is
exactly what the frontends expect (relative `/api` calls, same-origin
sockets). No CORS surprises, no `VITE_SOCKET_URL`, no separate static hosts.

**Why Cloud Run specifically:**
- The code already anticipates it — `clerkProxyMiddleware` buffers chunked
  Clerk responses because "the deployment edge (Cloud Run) rejects" them, so
  this codebase was built and tested against Cloud Run.
- Managed TLS, custom domain mapping, autoscaling, zero server patching.
- A Dockerfile with ffmpeg is trivial (see §6).

**The one setting that matters:** `--min-instances 1`. Scale-to-zero would
kill open Socket.IO connections and stop the in-process video worker. Min 1
keeps them alive — it's a feature, not waste.

**Cost:** ~$8–12/mo at low traffic (min 1 instance means CPU is always
allocated; that is what keeps WebSockets + the worker running).

**Alternatives that also work** (same single-container idea, slightly different
tradeoffs): Railway or Render (~$5–7/mo, git-push deploys, WebSockets on paid
plans) or a VPS + Caddy (~$4–6/mo, cheapest, but you patch the OS yourself).
If you ever outgrow one container, scale the API and the nginx router into two
Cloud Run services behind the same domain.

---

## 4. The step-by-step deployment plan

### Phase 0 — Prereqs

- [ ] Repo pushed to GitHub (`ENGR-SMITH/bi_model1`)
- [ ] A domain you control (or a subdomain like `app.yourdomain.com`)
- [ ] Accounts: Supabase, Cloudflare, Clerk, Paystack, Google Cloud (if Cloud Run)

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

Set these in the build environment (GitHub Actions secrets/vars or the CI of
your host):

| Env var | For which build |
|---------|-----------------|
| `VITE_CLERK_PUBLISHABLE_KEY` | tandem, authors-den, creators-den (their own `.env` or CI env) |
| `CLERK_PUBLISHABLE_KEY` (root `.env`) | oracle-admin (reads it via `envDir`) |
| `BASE_PATH`, `PORT` | all four (any valid values — they shape the build, not the server) |

### Phase 3 — Deploy the API server (Cloud Run)

1. **Dockerfile** (new file in `artifacts/api-server/`, example at the bottom
   of this doc): base image `node:24-bookworm-slim`, `apt-get install ffmpeg`,
   copy the repo, `pnpm install --frozen-lockfile`, build, and run
   `node dist/index.mjs`.
2. **Deploy** (or use Cloud Build / GitHub Actions):
   ```bash
   gcloud run deploy tandem-api \
     --source . \
     --region us-central1 \
     --allow-unauthenticated \
     --min-instances 1 \
     --memory 2Gi \
     --cpu 1 \
     --timeout 300
   ```
3. **Set env vars** on the service (all of Phase-5's list).

### Phase 4 — Deploy the one container (frontends + router + API)

**The recommended path: a single Cloud Run service.** Build one Docker image
that contains nginx + the four built SPAs + the Node API bundle, and start
both processes (entrypoint script below). The nginx config inside the image:

```nginx
# artifacts/api-server/nginx.conf
server {
  listen 8080;
  server_name _;
  root /srv/tandem/root;              # Tandem build (BASE_PATH=/)
  index index.html;

  location /api/       { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
  location /socket.io/ { proxy_pass http://127.0.0.1:3000; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
  location /authors-den/  { alias /srv/tandem/authors-den/;  try_files $uri $uri/ /authors-den/index.html; }
  location /creators-den/ { alias /srv/tandem/creators-den/; try_files $uri $uri/ /creators-den/index.html; }
  location /oracle-admin/ { alias /srv/tandem/oracle-admin/; try_files $uri $uri/ /oracle-admin/index.html; }

  location / { try_files $uri $uri/ /index.html; }   # SPA fallback
}
```

```bash
# artifacts/api-server/entrypoint.sh
#!/bin/sh
node --enable-source-maps ./dist/index.mjs &   # API on :3000
nginx -g 'daemon off;'                          # router in foreground
```

Deploy with `--min-instances 1` so WebSockets and the video worker stay alive.

> Whatever you choose: **one public origin**, path-based routing, SPA
> fallback, and `/api` + `/socket.io` forwarded to the API server.

### Phase 5 — Environment variables (API server)

Copy from `PRODUCTION-ENV.md`. The fail-closed list:

```env
NODE_ENV=production
PORT=3000
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
   put DNS at Cloudflare, and add a `CNAME app →` your Cloud Run service URL,
   then map the custom domain in Cloud Run.

### Phase 7 — Launch checklist

- [ ] `https://app.yourdomain.com/api/healthz` returns 200
- [ ] Sign in with Clerk on Tandem works (production keys)
- [ ] Author Den reachable at `/authors-den/`, Creator Den at `/creators-den/`,
      Oracle Admin at `/oracle-admin/` — and deep links refresh without 404
- [ ] Socket.IO connects (presence roster / job progress updates live)
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
3. **Add a DNS record** pointing at Cloud Run:
   `CNAME  app  →  <your-cloud-run-service-url>` (e.g.
   `tandem-api-abc123-uc.a.run.app`).
4. **Map the custom domain in Cloud Run:** open the service → **Domain** tab →
   add `app.yourdomain.com` → verify ownership via the TXT record Cloud Run
   gives you → wait for the HTTPS certificate.
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
| Code changes | Push to `main` → CI rebuilds the 4 SPAs + API image → redeploy (or `gcloud run deploy` with `--source .`) |
| Backups | Supabase handles Postgres backups (PITR on paid plans). R2: enable bucket versioning |
| Scaling | Bump Cloud Run instances/memory; add Redis + worker fleet when video load grows |
| Secrets | Keep everything in the host's env manager, never in git (`.env` is git-ignored) |

---

## 7. Reference: the one-container Dockerfile (nginx + API)

```dockerfile
# artifacts/api-server/Dockerfile
FROM node:24-bookworm-slim

# ffmpeg is required for real video proxies/renders/audio/exports.
# nginx serves the four built SPAs and proxies /api + /socket.io to Node.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nginx \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install with pnpm (workspace-aware). Use corepack for pnpm in CI.
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY tsconfig.base.json tsconfig.json ./

RUN pnpm install --frozen-lockfile

# Build the API bundle.
RUN pnpm --filter @workspace/api-server run build

# Build the four SPAs with their base paths baked in (BASE_PATH + PORT are
# required by each Vite config; VITE_CLERK_PUBLISHABLE_KEY comes from the
# build environment, and the repo-root .env must hold CLERK_PUBLISHABLE_KEY
# for Oracle Admin).
RUN PORT=3001 BASE_PATH=/             pnpm --filter @workspace/tandem build \
 && PORT=3002 BASE_PATH=/authors-den/ pnpm --filter @workspace/authors-den build \
 && PORT=3003 BASE_PATH=/creators-den/ pnpm --filter @workspace/creators-den build \
 && PORT=3004 BASE_PATH=/oracle-admin/ pnpm --filter @workspace/oracle-admin build

# Ship the built SPAs into the nginx docroots.
RUN mkdir -p /srv/tandem/root /srv/tandem/authors-den /srv/tandem/creators-den /srv/tandem/oracle-admin \
 && cp -r artifacts/tandem/dist/public/. /srv/tandem/root/ \
 && cp -r artifacts/authors-den/dist/public/. /srv/tandem/authors-den/ \
 && cp -r artifacts/creators-den/dist/public/. /srv/tandem/creators-den/ \
 && cp -r artifacts/oracle-admin/dist/public/. /srv/tandem/oracle-admin/

COPY artifacts/api-server/nginx.conf /etc/nginx/conf.d/default.conf
COPY artifacts/api-server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
EXPOSE 8080
CMD ["/entrypoint.sh"]
```

> Cloud Run forwards requests to port 8080, so nginx listens there and proxies
> `/api` + `/socket.io` to Node on `127.0.0.1:3000`. Set `--min-instances 1`
> (Socket.IO + in-process worker), give the container a writable `/tmp` for
> uploads (or point `VIDEO_UPLOAD_DIR` at a volume / rely on R2 for durability
> — the worker already restores originals from R2 after restarts), and set
> `--timeout` comfortably above your longest ffmpeg job or push those jobs to
> the BullMQ worker fleet instead.

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