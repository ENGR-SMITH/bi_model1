# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server test` — run the collaboration + video + realtime route tests (vitest + in-memory SQLite)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Realtime (blueprint §6/§11): the API server attaches a Socket.IO server on its own port (`/socket.io`) with Clerk JWT handshake auth. Project rooms stream `job.progress`, `comment.new`/`updated`, `submission.new`/`decided`, `asset.uploaded`/`processed`, `timeline.saved`, `grant.created`/`revoked`; each user's room streams `notification.new`; presence (`presence:join`/`update`/`leave` + `presence.roster`/`updated`) drives the "who's editing which leg" strip. The Creators Den dev server proxies `/socket.io` (with `ws: true`) to the API server.
- `pnpm --filter db run push-force` — push DB schema changes (dev only; `--force` auto-approves incremental changes)
- Boot the Creators Den app (dedicated video platform): `cd artifacts/creators-den && MSYS_NO_PATHCONV=1 PORT=5175 BASE_PATH=/creators-den/ npx vite` — the Tandem dev server proxies `/creators-den` to it (add `VITE_CREATORS_DEN_PROXY_TARGET` to override the target).
- Video job queue (blueprint §6/§9): **BullMQ + Redis**. Set `REDIS_URL` (e.g. `redis://localhost:6379`) to enable BullMQ mode — the API server then stops polling and only bridges worker progress to Socket.IO. Run the worker fleet: `pnpm --filter @workspace/api-server run workers` (all capabilities in one process) or per capability: `worker:proxy`, `worker:transcribe`, `worker:sync`, `worker:render`, `worker:audio`, `worker:finish` (EXPORT + THUMBNAIL), `worker:reference`. One queue per job type (`tandem-video-*`); rows in `tandem_video_jobs` stay the source of truth, BullMQ is the claim layer (jobId = row id, 3 attempts with exponential backoff). Without `REDIS_URL` the classic in-process polling loop runs instead (isolated tests use this), so local dev works with zero extra services.
- Required env: `DATABASE_URL` — Postgres connection string
- Local dev database: a dedicated `tandem` database is provisioned on the machine's PostgreSQL 18. Connect with `postgres://postgres:<password>@localhost:5432/tandem` and push the schema before running the API.
- The API server only enables Clerk auth when `CLERK_SECRET_KEY` is set; without it, collaboration routes return 401 (same behavior the route tests assert).
- Required env (auth): `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` — collaboration routes require a signed-in Clerk session.

### Local two-account walkthrough

1. Push the schema: `cd lib/db && DATABASE_URL='postgres://postgres:<password>@localhost:5432/tandem' pnpm exec drizzle-kit push --force`
2. Boot the API server (port 3000) with `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `PORT=3000`, `NODE_ENV=development`.
3. Boot the Tandem app: `cd artifacts/tandem && MSYS_NO_PATHCONV=1 PORT=5173 BASE_PATH=/ npx vite` (the dev-only `/api` proxy in `vite.config.ts` routes to :3000; `artifacts/tandem/.env` holds `VITE_CLERK_PUBLISHABLE_KEY`).
4. Open http://localhost:5173 and sign in. This Clerk instance only enables Google OAuth + ticket sign-in, so use Google (or mint test-user sessions via the Backend API — see `.local/setup-accounts.mjs` and `.local/walkthrough.mjs`).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
