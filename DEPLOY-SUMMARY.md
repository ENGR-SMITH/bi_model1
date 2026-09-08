# Deploy this app on Render — summary

## What the codebase is

One repo, one API server, four SPAs, optional video workers, optional desktop agent.

- **API server** — `artifacts/api-server`. Express 5 + Socket.IO + Clerk proxy/auth + Paystack hosted checkout/webhooks + video job queue + YouTube channel analytics sync + storage metering/retention + Story Oracle AI routing. Built by `build.mjs` (esbuild) into `dist/index.mjs` and `dist/workers/*`.
- **Four SPAs** — `artifacts/tandem` (main hub, `/`), `artifacts/authors-den` (`/authors-den/`), `artifacts/creators-den` (`/creators-den/`), `artifacts/oracle-admin` (`/oracle-admin/`). All Vite + React + Clerk + TanStack Query.
- **Desktop agent** — `artifacts/desktop-agent`. Electron app, loopback control server on port 41737, FFmpeg proxy generation, R2 upload via presigned URLs, browser-based Clerk sign-in via the web app's `/creators-den/agent-signin`.
- **Mockup sandbox** — `artifacts/mockup-sandbox`. Standalone UI scratchpad, not part of the core product.

The production topology the code is written for is a **single origin with path-based routing**: nginx serves the four SPAs by base path and proxies `/api` + `/socket.io` to the Node server in the same container. The SPAs call the API with **relative `/api/...` paths** and open Socket.IO on **same-origin `/socket.io`**. There is no `VITE_API_BASE_URL` baked into the SPA builds — `customFetch` only prepends a base URL if `setBaseUrl()` is called, and it isn't called in the web apps. That is why the one-container design is not optional.

## What is already done in the code

- `artifacts/api-server/Dockerfile` installs ffmpeg + nginx, pins pnpm, declares the two Clerk build args, builds the API bundle, builds all four SPAs with their `PORT` + `BASE_PATH`, and copies the built SPAs into nginx docroots.
- `artifacts/api-server/nginx.conf` lifts upload limits to `client_max_body_size 0`, proxies `/api` and `/socket.io` to `127.0.0.1:3000`, and serves the four SPAs by base path with SPA fallback.
- `artifacts/api-server/entrypoint.sh` starts Node on `PORT=3000` in the background and nginx in the foreground on `8080`.
- The three non-Oracle SPAs no longer need per-app `.env` files. Their Vite configs now use `envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY']`, so the same Clerk publishable key that feeds the Dockerfile build args also reaches their client bundles.

## What was fixed in this session

### 1. `artifacts/tandem/vite.config.ts`
Added:
```
envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY']
```
so the Tandem build picks up the Clerk publishable key from the Dockerfile build env instead of a per-app `.env` file.

### 2. `artifacts/authors-den/vite.config.ts`
Added the same `envPrefix`:
```
envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY']
```
for the same reason.

### 3. `artifacts/creators-den/vite.config.ts`
Added the same `envPrefix`:
```
envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY']
```
and used `envPrefix` instead of `define` so the dev-auth toggle does not leak into the client bundle.

### 4. `RENDER-DEPLOY.md`
Step-by-step Render Docker deployment instructions derived from the actual codebase.

### 5. `RENDER-CHECKLIST.md`
What is ready versus what is still external.

## What the Dockerfile already does

- installs ffmpeg + nginx,
- pins pnpm 10 explicitly,
- declares `ARG VITE_CLERK_PUBLISHABLE_KEY` and `ARG CLERK_PUBLISHABLE_KEY`,
- sets them as env so the four SPA builds see them,
- fails the build if either Clerk key arg is missing,
- copies the whole repo,
- installs deps with `pnpm install --frozen-lockfile`,
- builds the API bundle with `pnpm --filter @workspace/api-server run build`,
- builds all four SPAs:
  ```
  PORT=3001 BASE_PATH=/               pnpm --filter @workspace/tandem build
  && PORT=3002 BASE_PATH=/authors-den/   pnpm --filter @workspace/authors-den build
  && PORT=3003 BASE_PATH=/creators-den/  pnpm --filter @workspace/creators-den build
  && PORT=3004 BASE_PATH=/oracle-admin/  pnpm --filter @workspace/oracle-admin build
  ```
- copies the four built SPAs into `/srv/tandem/{root,authors-den,creators-den,oracle-admin}`,
- drops in `artifacts/api-server/nginx.conf` and `artifacts/api-server/entrypoint.sh`,
- makes `entrypoint.sh` executable,
- exposes 8080 and runs `/entrypoint.sh`.

## Required Render service setup

### Service type
A Render **Web Service**, built from Docker. Do not use a plain Node service. The app is structured as one container with nginx + Node.

### Build context
Repo root. The Dockerfile does `COPY . .` and the build needs the whole workspace to run the `--filter @workspace/...` commands.

### Dockerfile path
`artifacts/api-server/Dockerfile`

### Service environment variables

At minimum for a bootable production deploy:

- `NODE_ENV=production`
- `PORT=8080`
- `DATABASE_URL=postgresql://...`
- `CLERK_PUBLISHABLE_KEY=pk_live_...`
- `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...`
- `CLERK_SECRET_KEY=sk_live_...`
- `CORS_ORIGINS=https://yourapp.com,https://authors.yourapp.com,https://creators.yourapp.com,https://admin.yourapp.com`
- `ADMIN_EMAIL=you@yourdomain.com`
- `SESSION_SECRET=<openssl rand -hex 32>`

Optional, depending on which features you want live on day one:

- `PAYSTACK_SECRET_KEY=sk_live_...`
- `CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY`, `CF_R2_SECRET_KEY`, `CF_R2_BUCKET`
- `VIDEO_UPLOAD_DIR` if you want uploads on a Render Disk path
- `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_DATA_API_KEY`, `YOUTUBE_REDIRECT_URI`
- `GROQ_API_KEY`, `GROQ_BASE_URL`, `GROQ_MODEL_ID`
- `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL_ID`
- `OLLAMA_BASE_URL`, `OLLAMA_MODEL_ID`
- `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL_ID`
- `FREEBUFF_API_KEY`, `FREEBUFF_BASE_URL`, `FREEBUFF_MODEL_ID`

### Why `PORT=8080` matters
Render injects `PORT=10000` by default, but nginx is configured to listen on 8080. The service env overrides Render's default so nginx can bind. The entrypoint hardcodes Node on 3000 so nginx can proxy to it inside the container.

### Why both Clerk keys are needed on the service
The Dockerfile declares:
```
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG CLERK_PUBLISHABLE_KEY
```
and fails the build if either is empty. Render auto-translates service env vars into Docker build args, so setting `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` on the service is enough. If your Render plan or Docker setup requires explicit build args, set both of those to the same Clerk publishable key.

## Prerequisites before you push

### 1. A real database
Create one on Supabase, Neon, or any Postgres Render service, then push the schema from the repo root before the API server starts serving traffic:
```
DATABASE_URL='postgresql://user:password@host:5432/tandem' pnpm --filter db run push-force
```
or
```
DATABASE_URL='postgresql://user:password@host:5432/tandem' pnpm exec drizzle-kit push --force --config ./drizzle.config.ts
```
The API server needs `DATABASE_URL` at runtime. Without it the DB module never loads.

### 2. A strong `SESSION_SECRET`
Oracle Admin refuses to boot in production with the default development key. Generate one and keep it stable across deploys:
```
openssl rand -hex 32
```

## How to verify the image locally before pushing

Build the same image locally to catch build failures before Render does:
```
cd artifacts/api-server
docker buildx build . \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_... \
  --build-arg CLERK_PUBLISHABLE_KEY=pk_test_... \
  --load
```
A successful local build means the same env on Render should build.

If you cannot run Docker here, the next-best check is the four SPA builds individually from the repo root:
```
cd artifacts/tandem && PORT=3001 BASE_PATH=/ VITE_CLERK_PUBLISHABLE_KEY=pk_test_... npx vite build
cd artifacts/authors-den && PORT=3002 BASE_PATH=/authors-den/ VITE_CLERK_PUBLISHABLE_KEY=pk_test_... npx vite build
cd artifacts/creators-den && PORT=3003 BASE_PATH=/creators-den/ VITE_CLERK_PUBLISHABLE_KEY=pk_test_... npx vite build
cd artifacts/oracle-admin && PORT=5176 BASE_PATH=/oracle-admin/ npx vite build
```
The Oracle Admin build does not need `VITE_CLERK_PUBLISHABLE_KEY` because it reads `CLERK_PUBLISHABLE_KEY` from the repo-root `.env` via `envDir`.

## What will not work until you add it

- Real payments until `PAYSTACK_SECRET_KEY` is set and the webhook is registered.
- Durable video storage until R2 is configured or a Render Disk is attached to `VIDEO_UPLOAD_DIR`.
- YouTube channel sync until the YouTube env vars are set and the OAuth redirect URI is registered with Google.
- Story Oracle AI routing until at least one provider is configured in Oracle Admin.
- Single-machine video processing is the current design. The worker runs in-process. If you later add Redis and BullMQ workers, the row contract stays the same, but today there is no Redis-backed queue.

## What to do after the service is live

1. Point Clerk at the deployed domain. Once you have the Render URL or a custom domain, add those origins to your Clerk instance as allowed origins / redirect URLs.
2. Point Paystack at the deployed webhook:
   ```
   https://<your-render-url>/api/paystack/webhook
   ```
3. Add a custom domain if you want one. After the domain is live, update `CORS_ORIGINS` if you added a new origin, and update Clerk and Paystack URLs to match.
4. Decide on uploads. By default `VIDEO_UPLOAD_DIR` lives on the container filesystem. If you expect real upload traffic, attach a Render Disk and set `VIDEO_UPLOAD_DIR` to a path on that disk. If you also configure R2, the durable copies survive restarts regardless.

## How the app behaves if something is missing

The codebase is written to fail closed rather than silently run broken:

- The server exits with a message if `CORS_ORIGINS` is empty in production.
- Oracle Admin exits with a message if `ADMIN_EMAIL`, a strong non-default `SESSION_SECRET`, or `CLERK_SECRET_KEY` is missing in production.
- The Docker build exits with a message if both Clerk build args are not supplied.
- The three SPAs and Oracle Admin will not sign anyone in if the publishable key is missing at build time.

So if the deploy fails, it should tell you which piece is missing rather than starting up partially broken.
