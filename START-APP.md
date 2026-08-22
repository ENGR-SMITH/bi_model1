# START-APP.md — How to run the whole app on your local PC

This guide walks you through running **everything** in this repo on your own machine:
the Tandem app, the Author Den, the Creator Den, the API server, the database, and
(optionally) the Oracle Admin and video workers.

Everything is a **pnpm workspace** monorepo. All commands below show **which directory**
to run them from. Paths are relative to the repo root (the folder that contains
`package.json`, `pnpm-workspace.yaml`, and `artifacts/`).

---

## 1. What you're running (architecture & ports)

| App | Directory | Port | Base path | Purpose |
|-----|-----------|------|-----------|---------|
| **Tandem** (main hub) | `artifacts/tandem` | `5173` | `/` | The main web app. Proxies `/api`, `/authors-den`, `/creators-den`, and `/socket.io` to the other services. **Open this one in your browser.** |
| **Author Den** | `artifacts/authors-den` | `5174` | `/authors-den/` | Writing studio (books/projects, oracle AI, collaboration). |
| **Creator Den** | `artifacts/creators-den` | `5175` | `/creators-den/` | Video version-control platform — Selects / Cut / Sound / Finish / Thumbnail review stages; external-editor checkout & import, commits, pull requests, A/B compare (no in-browser editing). |
| **API server** | `artifacts/api-server` | `3000` | — | Express REST API + Socket.IO realtime + Clerk auth + AI (Story Oracle) + video job queue. |
| **PostgreSQL** | — | `5432` | — | The database. Schema lives in `lib/db`. |
| Oracle Admin *(optional)* | `artifacts/oracle-admin` | `5176` | `/oracle-admin/` | Private control room for AI model providers (login code `ADMIN_ACCESS_CODE`). |
| Mockup sandbox *(optional)* | `artifacts/mockup-sandbox` | `5177` | `/` | Standalone UI sandbox, not part of the main flow. |

> The Tandem dev server **proxies** the Author Den and Creator Den, so you can reach
> them at `http://localhost:5173/authors-den/` and `http://localhost:5173/creators-den/`.
> You still need to run their dev servers (ports 5174/5175) for the proxy to work.

---

## 2. Prerequisites

Install these on your PC first:

- **Node.js 24** (the project targets Node 24 — see `.replit`). Check with `node -v`.
- **pnpm** (workspace package manager). If you don't have it:
  ```bash
  npm install -g pnpm
  ```
  Check with `pnpm -v`. The repo **refuses to install with npm/yarn** (the root
  `preinstall` script enforces pnpm).
- **PostgreSQL 16+** running locally on port `5432`. On Windows, install via the
  official installer or `winget install PostgreSQL.PostgreSQL.16`. Make sure the
  service is started.
- **FFmpeg** (`ffmpeg` + `ffprobe`) for real video transcoding. Without it the API
  server falls back to a "demo" proxy — a copy of your original file — which only
  previews when the source is already a browser-native H.264 MP4/WebM.
  - Replit: `ffmpeg` is already listed under `[nix] packages` in `.replit`.
  - Linux: `sudo apt install ffmpeg` · macOS: `brew install ffmpeg` ·
    Windows: `winget install Gyan.FFmpeg`.

> **Windows (Git Bash / PowerShell) note:** prefix the dev-server commands with
> `MSYS_NO_PATHCONV=1` (Git Bash) so Vite doesn't mangle the `BASE_PATH` value.
> Example: `MSYS_NO_PATHCONV=1 PORT=5175 BASE_PATH=/creators-den/ pnpm run dev`.
> On Linux/macOS you can omit it, but including it is harmless.

---

## 3. One-time setup

### 3.1 Clone the repo

```bash
git clone <your-repo-url> bi_model1
cd bi_model1
```

### 3.2 Install dependencies

Run from the **repo root**:

```bash
pnpm install
```

This installs every workspace package (`artifacts/*`, `lib/*`, `scripts`).

### 3.3 Create the environment file

The API server automatically loads a `.env` file from the **repo root** (or from
`artifacts/api-server`). Copy the template and fill in your values:

```bash
# from the repo root
cp .env.example .env
```

Edit `.env` and set at least:

| Variable | What to put |
|----------|-------------|
| `PORT` | `3000` (API server port — keep this) |
| `DATABASE_URL` | `postgresql://postgres:<your-password>@localhost:5432/tandem` |
| `CLERK_PUBLISHABLE_KEY` | Your Clerk instance's publishable key (sign up at clerk.com) |
| `CLERK_SECRET_KEY` | Your Clerk instance's secret key |
| `ADMIN_ACCESS_CODE` | Password for the Oracle Admin (default `TANDEM_123`) |
| `SESSION_SECRET` | Any long random string (keep it stable across restarts) |

Optional AI provider credentials (used by the Story Oracle AI in Author/Creator Den):
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`, `LMSTUDIO_BASE_URL`,
`FREEBUFF_API_KEY`. These can also be entered later in the Oracle Admin page.

> **Frontend Clerk key:** the Tandem / Author Den / Creator Den apps also need the
> publishable key at build/dev time. Create small `.env` files:
> ```bash
> # artifacts/tandem/.env
> VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
> ```
> ```bash
> # artifacts/authors-den/.env
> VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
> ```
> ```bash
> # artifacts/creators-den/.env
> VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
> ```
> Without Clerk keys the apps still boot, but collaboration/auth routes return 401.

### 3.4 Create the database & push the schema

From the **repo root**, run:

```bash
DATABASE_URL='postgresql://postgres:<your-password>@localhost:5432/tandem' pnpm --filter db run push-force
```

This creates the `tandem` database tables (the `--force` flag auto-approves schema
changes so it won't hang waiting for input). Re-run this whenever the schema changes.

> Equivalent, from inside `lib/db`:
> ```bash
> cd lib/db
> DATABASE_URL='postgresql://postgres:<your-password>@localhost:5432/tandem' pnpm exec drizzle-kit push --force --config ./drizzle.config.ts
> ```

### 3.5 Build the shared library types (first time only)

The API client / Zod libs export TypeScript source directly, but type-checking needs
their generated declarations. From the **repo root**:

```bash
pnpm run typecheck:libs
```

---

## 4. Starting everything (do this in order)

Open **four terminal windows** (one per service). The API server must be up before
the frontends.

### Step 1 — Start the API server

Directory: `artifacts/api-server`

```bash
cd artifacts/api-server
pnpm run dev
```

What it does: builds the server bundle (`node build.mjs`) then starts it
(`node ./dist/index.mjs`). It reads env from the root `.env` you created.
You should see `Server listening` with `port: 3000`.

> The `dev` script builds first, so startup takes a few seconds. Keep this terminal
> running.

### Step 2 — Start Tandem (the main app)

Directory: `artifacts/tandem`

```bash
cd artifacts/tandem
PORT=5173 BASE_PATH=/ pnpm run dev
```

### Step 3 — Start the Author Den

Directory: `artifacts/authors-den`

```bash
cd artifacts/authors-den
PORT=5174 BASE_PATH=/authors-den/ pnpm run dev
```

### Step 4 — Start the Creator Den

Directory: `artifacts/creators-den`

```bash
cd artifacts/creators-den
PORT=5175 BASE_PATH=/creators-den/ pnpm run dev
```

### Step 5 — Open the app

Open **http://localhost:5173** in your browser.

- Landing / sign-in: `http://localhost:5173`
- Author Den: `http://localhost:5173/authors-den/`
- Creator Den: `http://localhost:5173/creators-den/`

---

## 5. Optional services

### Oracle Admin (AI provider control room)

Directory: `artifacts/oracle-admin`

```bash
cd artifacts/oracle-admin
PORT=5176 BASE_PATH=/oracle-admin/ pnpm run dev
```

Then open `http://localhost:5176/oracle-admin/` and log in with `ADMIN_ACCESS_CODE`
(default `TANDEM_123`). Here you configure the AI model providers (Groq, OpenRouter,
Ollama, LM Studio, Freebuff) that power the Story Oracle.

### Video workers + Redis (only needed for heavy video processing)

By default the API server processes video jobs in-process (a polling loop), so **no
Redis is needed** for basic local use. If you want the BullMQ queue mode:

1. Run Redis locally (or set `REDIS_URL` in `.env`, e.g. `redis://localhost:6379`).
2. Start the worker fleet from the **repo root**:
   ```bash
   pnpm --filter @workspace/api-server run workers
   ```
   (or one capability at a time: `worker:proxy`, `worker:transcribe`, `worker:sync`,
   `worker:render`, `worker:audio`, `worker:finish`, `worker:reference`).

### Mockup sandbox (UI scratchpad)

Directory: `artifacts/mockup-sandbox`

```bash
cd artifacts/mockup-sandbox
pnpm run dev
```

---

## 6. Useful commands (from the repo root unless noted)

| Task | Command | Run from |
|------|---------|----------|
| Install all dependencies | `pnpm install` | repo root |
| Typecheck everything | `pnpm run typecheck` | repo root |
| Build everything (typecheck + build) | `pnpm run build` | repo root |
| API server tests | `pnpm --filter @workspace/api-server test` | repo root |
| Push DB schema (after schema changes) | `DATABASE_URL='postgresql://...' pnpm --filter db run push-force` | repo root |
| Regenerate API hooks + Zod schemas from OpenAPI | `pnpm --filter @workspace/api-spec run codegen` | repo root |
| Run one app's dev server | `PORT=<port> BASE_PATH=<base>/ pnpm run dev` | that app's dir |
| Build one app for production | `pnpm run build` | that app's dir |

---

## 7. Troubleshooting

- **`PORT environment variable is required`** — every Vite app and the API server
  require `PORT` (and the frontends require `BASE_PATH`). Always pass them, e.g.
  `PORT=5173 BASE_PATH=/`.
- **`DATABASE_URL must be set`** — the API server and DB tooling need `DATABASE_URL`.
  Make sure your root `.env` has it (or export it in the shell).
- **`ECONNREFUSED :3000` in the frontend** — the API server isn't running. Start
  Step 1 first.
- **Author/Creator Den shows 404 at `/authors-den/`** — the Author Den (5174) or
  Creator Den (5175) dev server isn't running; Tandem proxies to them.
- **Collaboration routes return 401** — Clerk isn't configured. Set
  `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` in `.env` and restart the API server.
- **Port already in use** — something else is on 3000/5173/5174/5175. Stop the
  conflicting process, or pick a different port (and update the matching proxy
  target env var, e.g. `VITE_API_PROXY_TARGET`).
- **Schema push hangs** — use `push-force` (the `--force` flag) so Drizzle doesn't
  prompt for confirmation.
- **Vault previews show a codec error / black video** — ffmpeg isn't installed, so
  the server serves your original file as the "proxy". Install ffmpeg (see
  Prerequisites) and restart the API server so it transcodes to H.264 MP4.
- **Windows path mangling** — use the `MSYS_NO_PATHCONV=1` prefix in Git Bash, or
  run the commands from PowerShell where this isn't an issue.
