# Render deployment — what's ready and what remains

## Status: Docker image is now deployable; env + DB + domain are external steps.

### What this repo can actually build and ship

- One-container Render Web Service (Docker) is the only deploy target the code is written for.
- `artifacts/api-server/Dockerfile` now:
  - installs ffmpeg + nginx,
  - declares `ARG VITE_CLERK_PUBLISHABLE_KEY` and `ARG CLERK_PUBLISHABLE_KEY`,
  - fails the build if either Clerk key arg is missing,
  - builds the API bundle with `pnpm --filter @workspace/api-server run build`,
  - builds all four SPAs with the right `PORT` + `BASE_PATH` and the same Clerk key,
  - copies the four built SPAs into `/srv/nexet/{root,authors-den,creators-den,oracle-admin}`,
  - drops in `nginx.conf` and `entrypoint.sh`.
- `artifacts/api-server/nginx.conf` + `entrypoint.sh` start Node on `127.0.0.1:3000` and nginx on `8080`; nginx serves the four SPAs by base path and proxies `/api` + `/socket.io` to Node.

### What changed in this session

- `artifacts/nexet/vite.config.ts` — added `envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY']`.
- `artifacts/authors-den/vite.config.ts` — added `envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY']`.
- `artifacts/creators-den/vite.config.ts` — added `envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY']`, and chose `envPrefix` over `define` so `VITE_CREATORS_DEV_NO_AUTH` is never baked into the client bundle.
- No per-app `.env` files are needed for Nexet / Author Den / Creator Den anymore — the Clerk publishable key now comes from the Dockerfile build arg/env.

### What still has to be done before the service boots

#### 1. Required to build the image
- `VITE_CLERK_PUBLISHABLE_KEY` and `CLERK_PUBLISHABLE_KEY` must be present on the Render service as env vars. Render auto-translates service env vars into Docker build args, so one Clerk publishable key set on the service feeds both args.

#### 2. Required to boot the container
From the code I read, the container will fail closed (exit with a message) without:
- `DATABASE_URL` — Drizzle needs it and the DB module never loads without it.
- `CORS_ORIGINS` — `app.ts` throws in production without it.
- `ADMIN_EMAIL` — `routes/admin.ts` throws in production without it.
- a strong, non-default `SESSION_SECRET`.
- `CLERK_SECRET_KEY` — `routes/admin.ts` / Clerk proxy middleware need it.
- `WHOP_API_KEY` + `WHOP_ACCOUNT_ID` + `WHOP_PRODUCT_ID` + `WHOP_WEBHOOK_SECRET` / Whop webhook handling needs them.
- `CF_*` / R2 settings if the video upload/worker path is used.
- `YOUTUBE_*` if YouTube channel sync is used.
- `GROQ_*` / `OPENROUTER_*` / `OLLAMA_*` / `LMSTUDIO_*` depending on which Story Oracle AI path is active.

#### 3. Required before first real boot
- A live Postgres/Supabase database reachable from Render.
- A schema push with Drizzle against that database before the service starts serving users.

#### 4. Recommended after deploy
- Add a Render Disk for `VIDEO_UPLOAD_DIR` if upload volume is meaningful; the default container filesystem is ephemeral.
- Add the custom domain + DNS, then re-verify Clerk redirect URLs and the Whop webhook URL against the live domain.

### How to verify locally before pushing
Run the same build the Dockerfile runs:

```
cd artifacts/api-server
docker buildx build . \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_... \
  --build-arg CLERK_PUBLISHABLE_KEY=pk_test_... \
  --load
```

If that succeeds, the same env on Render should build. If it fails, the failure is in the build steps (frontend build, bundle, copy) and is visible locally before deploy.

### What is intentionally not in scope here
- Generating the real `SESSION_SECRET`, the real DB, the real Clerk/Whop keys, or the DNS setup — those are environment steps, not code steps.
- Enabling the video worker, YouTube sync, R2, or the Story Oracle providers — those are runtime toggles driven by the env, not build blockers.
