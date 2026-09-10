# Deploy this app on Render (Docker Web Service)

## What you are deploying

One Render Web Service, built from `artifacts/api-server/Dockerfile`, that runs nginx and the Node API server in one container:

- nginx on port 8080 serves the four SPAs by base path and proxies `/api` + `/socket.io` to Node.
- Node on `127.0.0.1:3000` runs the Express/Socket.IO API, the video job worker, storage maintenance, and YouTube channel analytics sync.
- The four frontends are Nexet (`/`), Author Den (`/authors-den/`), Creator Den (`/creators-den/`), and Oracle Admin (`/oracle-admin/`).

This is not a plain Node service. The code expects a single origin with path-based routing, and the SPAs call the API with relative `/api/...` paths and open Socket.IO on same-origin `/socket.io`.

## What is already done in the code

- `artifacts/api-server/Dockerfile` installs ffmpeg + nginx, pins pnpm, declares the two Clerk build args, builds the API bundle, builds all four SPAs with their `PORT` + `BASE_PATH`, and copies the built SPAs into nginx docroots.
- `artifacts/api-server/nginx.conf` lifts upload limits to `client_max_body_size 0`, proxies `/api` and `/socket.io` to `127.0.0.1:3000`, and serves the four SPAs by base path with SPA fallback.
- `artifacts/api-server/entrypoint.sh` starts Node on `PORT=3000` in the background and nginx in the foreground on `8080`.
- The three non-Oracle SPAs no longer need per-app `.env` files. Their Vite configs now use `envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY']`, so the same Clerk publishable key that feeds the Dockerfile build args also reaches their client bundles.

## Prerequisites before you push

Do these first. The container will refuse to boot without some of them, and will build incorrectly without others.

### 1. A real database

The app uses Drizzle against Postgres. Create one on Supabase, Neon, or any Postgres Render service, then push the schema from the repo root before the API server starts serving traffic:

```
DATABASE_URL='postgresql://user:password@host:5432/nexet' pnpm --filter db run push-force
```

Or the older form if that is what your workspace exposes:

```
DATABASE_URL='postgresql://user:password@host:5432/nexet' pnpm exec drizzle-kit push --force --config ./drizzle.config.ts
```

The API server needs `DATABASE_URL` at runtime. Without it the DB module never loads and the service cannot start serving requests.

### 2. A strong `SESSION_SECRET`

Oracle Admin refuses to boot in production with the default development key. Generate one and keep it stable across deploys:

```
openssl rand -hex 32
```

Paste that into your Render service env as `SESSION_SECRET`.

### 3. Clerk

From the Clerk dashboard:

- Get the **publishable key** (`pk_live_...` for production). This goes into the Render service env twice: once as `CLERK_PUBLISHABLE_KEY` for the Oracle Admin build, once as `VITE_CLERK_PUBLISHABLE_KEY` for the three SPAs. Render auto-translates service env vars into Docker build args, so one key set on the service feeds both.
- Get the **secret key** (`sk_live_...`). This is `CLERK_SECRET_KEY` on the Render service. The server refuses to boot in production without it because both the Oracle Admin auth path and the Clerk proxy middleware need it.

After the service is live and you have a domain, add the deployed origins as allowed sign-in URLs / redirect URLs in Clerk. Until then the dev/placeholder origins will not match.

### 4. Whop only if you want real payments

If you want real hosted checkout and webhooks, set the four Whop variables on the Render service: `WHOP_API_KEY` (`whop_...`), `WHOP_ACCOUNT_ID` (`biz_...`), `WHOP_PRODUCT_ID` (`prod_...`), and `WHOP_WEBHOOK_SECRET` (`ws_...`). The app can still boot without them, but real Whop checkouts and webhook handling need them. If you are not ready for that, leave them unset and the Whop paths will not function as production payments.

If you set them, use the live keys on the production service (test in the Whop sandbox first), and set the Whop webhook URL to your deployed `/api/whop/webhook` once the domain is live.

### 5. Cloudflare R2 only if you want durable video storage

The video pipeline works without R2: uploads and processing use the container filesystem, and reads stream from disk. With `CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY`, `CF_R2_SECRET_KEY`, and `CF_R2_BUCKET` set, the server generates presigned PUT/GET URLs and persists artifacts to R2 instead of local disk.

If you do not set R2 yet, the app still works, but uploaded/processed files live on the container disk and are lost on every restart unless you attach a Render Disk to `VIDEO_UPLOAD_DIR`.

### 6. Story Oracle AI providers only if you want the AI routing feature

Oracle Admin can use Groq, OpenRouter, Ollama, LM Studio, and Freebuff. Any of those can be entered later through the Oracle Admin UI and encrypted at rest with `SESSION_SECRET`. You do not need to set `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`, or `FREEBUFF_API_KEY` on the service to deploy. You only need the ones you want pre-seeded via env.

### 7. YouTube channel sync only if you want it

If you want YouTube channel syncing, set `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_DATA_API_KEY`, and `YOUTUBE_REDIRECT_URI` on the service. If you do not set them, the YouTube paths are inactive.

## Render service setup

### 1. Create the service

In the Render dashboard, create a new **Web Service**, choose **Docker** as the environment, and point it at this repo.

Do not create a plain Node service. The app is structured as one container with nginx + Node.

### 2. Set the build command and root

Use the repo root as the Docker build context. The Dockerfile lives at `artifacts/api-server/Dockerfile`.

If Render asks for a Dockerfile path, use:

```
artifacts/api-server/Dockerfile
```

If Render asks for a root directory for the build context, use the repo root, because the Dockerfile does `COPY . .` and the build needs the whole workspace to run `pnpm --filter @workspace/...`.

### 3. Set the service environment variables

On the Render service, add the env vars. Render turns service env vars into Docker build args automatically, so the build-time Clerk keys are set here too.

At minimum for a bootable production deploy:

- `NODE_ENV=production`
- `PORT=8080`
- `DATABASE_URL=postgresql://...` (your real database)
- `CLERK_PUBLISHABLE_KEY=pk_live_...`
- `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...`
- `CLERK_SECRET_KEY=sk_live_...`
- `CORS_ORIGINS=https://yourapp.com,https://authors.yourapp.com,https://creators.yourapp.com,https://admin.yourapp.com`
- `ADMIN_EMAIL=you@yourdomain.com`
- `SESSION_SECRET=<the 64-char hex you generated>`

Optional, depending on which features you want live on day one:

- `WHOP_API_KEY=whop_...`, `WHOP_ACCOUNT_ID=biz_...`, `WHOP_PRODUCT_ID=prod_...`, `WHOP_WEBHOOK_SECRET=ws_...`
- `CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY`, `CF_R2_SECRET_KEY`, `CF_R2_BUCKET`
- `VIDEO_UPLOAD_DIR` if you want uploads on a Render Disk path
- `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_DATA_API_KEY`, `YOUTUBE_REDIRECT_URI`
- `GROQ_API_KEY`, `GROQ_BASE_URL`, `GROQ_MODEL_ID`
- `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL_ID`
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL_ID`
- `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL_ID`
- `FREEBUFF_API_KEY`, `FREEBUFF_BASE_URL`, `FREEBUFF_MODEL_ID`

`CORS_ORIGINS` must list every origin that will call the API in production, comma-separated, with no trailing slash. If it is empty in production, the server exits at boot on purpose.

`PORT=8080` matters. Render injects `PORT=10000` by default, but nginx is configured to listen on 8080. The service env overrides Render's default so nginx can bind. The entrypoint hardcodes Node on 3000 so nginx can proxy to it inside the container.

### 4. Set the Docker build args

The Dockerfile declares:

```
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG CLERK_PUBLISHABLE_KEY
```

and fails the build if either is empty. Because Render auto-translates service env vars into Docker build args, setting `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` on the service is enough. If your Render plan or Docker setup requires explicit build args, set both of those to the same Clerk publishable key.

### 5. Do the DB push before opening the site to users

After the database is created and the service can reach it, push the schema:

```
DATABASE_URL='postgresql://user:password@host:5432/nexet' pnpm --filter db run push-force
```

Do this from the repo root. If you run the service before the schema exists, requests that touch the DB will fail.

## Verify the image locally before you push

Build the same image locally to catch build failures before Render does:

```
cd artifacts/api-server
docker buildx build . \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_... \
  --build-arg CLERK_PUBLISHABLE_KEY=pk_test_... \
  --load
```

A successful local build means the same env on Render should build. A failure means the problem is in the frontend builds, the bundle, or the copy steps, and you will see it locally before you deploy.

If you cannot run Docker here, the next-best check is the four SPA builds individually from the repo root:

```
cd artifacts/nexet && PORT=3001 BASE_PATH=/ VITE_CLERK_PUBLISHABLE_KEY=pk_test_... npx vite build
cd artifacts/authors-den && PORT=3002 BASE_PATH=/authors-den/ VITE_CLERK_PUBLISHABLE_KEY=pk_test_... npx vite build
cd artifacts/creators-den && PORT=3003 BASE_PATH=/creators-den/ VITE_CLERK_PUBLISHABLE_KEY=pk_test_... npx vite build
cd artifacts/oracle-admin && PORT=5176 BASE_PATH=/oracle-admin/ npx vite build
```

The Oracle Admin build does not need `VITE_CLERK_PUBLISHABLE_KEY` because it reads `CLERK_PUBLISHABLE_KEY` from the repo-root `.env` via `envDir`.

## After the service is live

### 1. Point Clerk at the deployed domain

Once you have the Render URL or a custom domain, add those origins to your Clerk instance as allowed origins / redirect URLs. Until they match, sign-in flows from the deployed apps will not complete.

### 2. Point Whop at the deployed webhook

If you enabled Whop, set the webhook URL in the Whop dashboard (Developer → Webhooks) to:

```
https://<your-render-url>/api/whop/webhook
```

Replace `<your-render-url>` with the actual deployed origin.

### 3. Add a custom domain if you want one

Add the domain in Render, then point your DNS to Render. After the domain is live, update `CORS_ORIGINS` if you added a new origin, and update Clerk and Whop URLs to match.

### 4. Decide on uploads

By default `VIDEO_UPLOAD_DIR` lives on the container filesystem. That is fine for low volume, but the disk is ephemeral. If you expect real upload traffic, attach a Render Disk and set `VIDEO_UPLOAD_DIR` to a path on that disk. If you also configure R2, the durable copies survive restarts regardless.

## What will not work until you add it

- Real payments until the `WHOP_*` vars are set and the webhook is registered.
- Durable video storage until R2 is configured or a Render Disk is attached to `VIDEO_UPLOAD_DIR`.
- YouTube channel sync until the YouTube env vars are set and the OAuth redirect URI is registered with Google.
- Story Oracle AI routing until at least one provider is configured in Oracle Admin.
- Single-machine video processing is the current design. The worker runs in-process. If you later add Redis and BullMQ workers, the row contract stays the same, but today there is no Redis-backed queue.

## How the app behaves if something is missing

The codebase is written to fail closed rather than silently run broken:

- The server exits with a message if `CORS_ORIGINS` is empty in production.
- Oracle Admin exits with a message if `ADMIN_EMAIL`, a strong non-default `SESSION_SECRET`, or `CLERK_SECRET_KEY` is missing in production.
- The Docker build exits with a message if both Clerk build args are not supplied.
- The three SPAs and Oracle Admin will not sign anyone in if the publishable key is missing at build time.

So if the deploy fails, it should tell you which piece is missing rather than starting up partially broken.
