# CREDENTIALS.md — Every credential this app needs, and how to get it

This app needs credentials from several platforms. Below is the **complete list**:
the platform to get each one from, exactly where on that platform it lives, and
step-by-step how to obtain it. Everything ends up in your `.env` file (copy
`.env.example` → `.env`) unless noted otherwise.

> **Golden rule:** never commit `.env`, API keys, or secrets to git. The
> `.env` file is git-ignored. When the docs below say "set in `.env`", keep it
> there and out of the repository.

---

## Quick index

| # | Platform | What you get | Used for | Required? |
|---|----------|--------------|----------|-----------|
| 1 | Clerk | Publishable + Secret keys | Sign-in / auth for all three apps | **Yes** |
| 2 | Clerk (Billing) | Stripe connection + plan slugs + webhook secret | Subscriptions, passes, space/project purchases | For real payments |
| 3 | Neon / Supabase (or local Postgres) | `DATABASE_URL` | Database | **Yes** |
| 4 | Cloudflare R2 | Account ID + bucket + Access/Secret keys | Video proxies/exports/bundles storage | For R2 storage |
| 5 | Groq | `GROQ_API_KEY` | Story Oracle AI (fast hosted models) | No (optional AI) |
| 6 | OpenRouter | `OPENROUTER_API_KEY` | Story Oracle AI (multi-model) | No (optional AI) |
| 7 | Ollama | Nothing (local) | Local AI inference | No |
| 8 | LM Studio | Nothing (local) | Local AI inference | No |
| 9 | Freebuff | `FREEBUFF_API_KEY` | Model gateway AI | No (optional AI) |
| 10 | Redis (Upstash/Redis Cloud/local) | `REDIS_URL` | BullMQ video job queue | No (optional) |
| 11 | Stripe | Account | Real card payments via Clerk Billing | For real payments |
| 12 | GitHub | Secrets + vars | CI build of the desktop agent | For CI |

App-defined secrets (not from a platform — you create them):
`ADMIN_ACCESS_CODE`, `SESSION_SECRET` — see section 13.

---

## 1. Clerk — authentication (all apps)

**Platform:** https://dashboard.clerk.com

Clerk is the identity provider. One Clerk instance serves Tandem, Creator Den,
and Author Den. Every app uses the **same** publishable key; the API server
uses the same secret key.

**Step-by-step:**

1. Go to https://dashboard.clerk.com and sign up / log in.
2. Click **Create application**. Name it (e.g. `tandem`), pick your sign-in
   methods (email, Google, etc.), and create it.
3. On the application's home page you'll see two keys under **API Keys**:
   - **Publishable key** — starts with `pk_test_…` (or `pk_live_…` in prod)
   - **Secret key** — starts with `sk_test_…` (or `sk_live_…` in prod)
4. Click the eye / **Copy** buttons to copy each.

**Where they go:**

```env
# root .env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

And in **each frontend app's** own `.env` file (Vite apps need the publishable
key at build time):

```bash
# artifacts/tandem/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# artifacts/authors-den/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# artifacts/creators-den/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

> Test mode keys (`_test_`) are for development. When you go live, switch
> every app to the same `_live_` keys (from the Clerk dashboard → **Production**
> instance) and update all four files.

---

## 2. Clerk Billing (Subscriptions/Commerce) — payments

**Platform:** https://dashboard.clerk.com → your app → **Billing**

The ticket passes (TANDEM), storage space (Creator Den), and project-count
extensions (Author Den) are subscription products. Real card charging runs
through **Clerk Billing**, which connects to **Stripe** behind the scenes.

**Step-by-step (test mode first — no Stripe account needed):**

1. In your Clerk app, open **Billing → Settings** and click **Enable Billing**.
   In development this automatically uses a shared **Stripe test account**, so
   you can test with Stripe test cards (e.g. `4242 4242 4242 4242`) with zero
   Stripe setup.
2. Open **Billing → Subscription plans** → **User** tab → **Create plan**, and
   create each product you sell:
   - TANDEM ticket pass — `$1.88` per 3 weeks
   - Creator Den storage — `$20`/200 GB, `$40`/500 GB, `$60`/1 TB
   - Author Den projects — `$5`/+10, `$20`/+50, `$50`/+200
3. (Optional) Create **Features** under the **Features** section and attach
   them to plans (e.g. `storage_200gb`, `projects_50`).
4. Note the **exact plan slugs** you created (Clerk names them, e.g.
   `plan_xxx` or your chosen slugs) — the app's buy buttons need to reference
   them.
5. **Webhook** (to keep your subscription records in sync): open **Webhooks →
   Add Endpoint**, point it at your API server's webhook URL
   (`https://<api-host>/api/clerk/webhook`), subscribe to
   `subscription.created`, `subscription.updated`, `subscription.ended`,
   `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`, and
   copy the **Signing Secret** (starts `whsec_…`).

**Where they go:**

```env
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...
```

**Going live:** in **Billing → Settings**, connect your own Stripe account
(stripe.com). See section 11.

---

## 3. Database — PostgreSQL

**Platform (hosted):** https://neon.tech or https://supabase.com
**Platform (local):** your own machine (PostgreSQL 16+)

**Step-by-step — Neon (recommended hosted option):**

1. Go to https://neon.tech and sign up (free tier is fine).
2. Click **Create a project**, name it (e.g. `tandem`), pick a region.
3. On the project dashboard click **Connect**.
4. Copy the **connection string** — it looks like:
   `postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/tandem?sslmode=require`
   Use the **pooled** or **direct** string as you prefer.

**Where it goes:**

```env
DATABASE_URL=postgresql://user:password@host:5432/tandem
```

**Local alternative:** install PostgreSQL 16+ on your machine, create a
`tandem` database, and use:
`postgresql://postgres:<your-password>@localhost:5432/tandem`

**After setting it:** push the schema once (from repo root):
```bash
DATABASE_URL='<your-connection-string>' pnpm --filter db run push-force
```

---

## 4. Cloudflare R2 — video file storage

**Platform:** https://dash.cloudflare.com

R2 stores video proxies, renders/exports, and interchange bundles. The server
mints presigned URLs; browsers and the desktop agent stream bytes straight
from Cloudflare (zero egress fees).

**Step-by-step:**

1. Go to https://dash.cloudflare.com and log in.
2. In the sidebar, open **R2** (under **Storage & Databases**).
3. Click **Create Bucket**, name it (e.g. `tandem-media`), pick **Region:
   Automatic** (or your nearest), click **Create bucket**.
4. **Account ID:** it's on the dashboard sidebar / R2 overview page — a
   32-character hex string like `a1b2c3d4…`.
5. Create the API token: **R2 → Manage R2 API Tokens → Create API Token**.
   - Permission: **Object Read & Write**
   - Scope: your bucket (e.g. `tandem-media`)
   - Click **Create API Token**.
6. Copy the three values shown: **Access Key ID**, **Secret Access Key** (shown
   only once — save it immediately), and the **Account ID** if not already noted.
7. (Optional, for the in-app "Desktop agent" button) make the bucket public:
   **R2 → your bucket → Settings → Public access** → enable the `*.r2.dev`
   URL (or add a custom domain under **Custom Domains**). The public URL
   becomes your `VITE_AGENT_DOWNLOAD_URL`.

**Where they go:**

```env
CF_ACCOUNT_ID=<32-char account id>
CF_R2_BUCKET=tandem-media
CF_R2_ACCESS_KEY=<access key id>
CF_R2_SECRET_KEY=<secret access key>
```

---

## 5. Groq — Story Oracle AI (fast hosted models)

**Platform:** https://console.groq.com

**Step-by-step:**

1. Go to https://console.groq.com and sign up.
2. Open **API Keys** in the left sidebar.
3. Click **Create API Key**, give it a name, copy the key (starts `gsk_…`).

```env
GROQ_API_KEY=gsk_...
```

---

## 6. OpenRouter — Story Oracle AI (multi-model)

**Platform:** https://openrouter.ai

**Step-by-step:**

1. Go to https://openrouter.ai and sign up.
2. Click your avatar → **Keys**.
3. Click **Create Key**, copy it (starts `sk-or-v1-…`).

```env
OPENROUTER_API_KEY=sk-or-v1-...
```

---

## 7. Ollama — local AI (no key)

**Platform:** https://ollama.com (download) — runs on your own machine.

No API key. Install Ollama, then pull a model (e.g. `ollama pull llama3.2`).
The app only needs the base URL:

```env
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL_ID=llama3.2
```

---

## 8. LM Studio — local AI (no key)

**Platform:** https://lmstudio.ai (download) — runs on your own machine.

No API key. Start the local server (LM Studio → **Developer** → **Local
server**). The app only needs the base URL:

```env
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL_ID=local-model
```

---

## 9. Freebuff — model gateway

**Platform:** https://freebuff.com (the product you're using).

```env
FREEBUFF_API_KEY=
FREEBUFF_BASE_URL=http://localhost:8081/v1
FREEBUFF_MODEL_ID=deepseek-v4-flash
```

(Optional — the key can also be entered in the Oracle Admin page.)

---

## 10. Redis — video job queue (optional)

**Platform:** https://upstash.com or https://redis.io (local)

Only needed for BullMQ queue mode (heavy video processing across multiple
workers). Without it the API server processes jobs in-process, so local dev
works with no Redis.

**Upstash (hosted):**
1. Go to https://upstash.com, sign up, create a **Redis** database (free tier).
2. Copy the **REST URL** (starts `redis://default:…` or `rediss://…`).

**Local:** run Redis (`redis-server`) and use `redis://localhost:6379`.

```env
REDIS_URL=redis://localhost:6379
```

---

## 11. Stripe — real payments (only when going live)

**Platform:** https://stripe.com

Clerk Billing connects to Stripe to charge cards. In test mode Clerk provides a
shared test Stripe account, so **no Stripe account is needed to develop**. When
you're ready to accept real money:

1. Go to https://stripe.com and create an account.
2. In Clerk: **Billing → Settings** → connect your Stripe account (follow the
   OAuth connect flow Clerk shows).
3. Clerk then creates the products/prices in your Stripe account automatically
   from the plans you defined — you don't build products in Stripe yourself.

---

## 12. GitHub — CI secrets & vars (for the desktop-agent installer)

**Platform:** https://github.com

The CI workflow (`.github/workflows/build-desktop-agent.yml`) builds the
Windows `.exe` / macOS `.dmg` and publishes it to R2 on an `agent-v*` tag.
It needs these as **repository secrets** (Settings → Secrets and variables →
Actions → New repository secret):

| Name | Value |
|------|-------|
| `CF_ACCOUNT_ID` | Your Cloudflare account ID (section 4) |
| `CF_R2_ACCESS_KEY` | Your R2 Access Key ID (section 4) |
| `CF_R2_SECRET_KEY` | Your R2 Secret Access Key (section 4) |

And optionally a **repository variable** (Settings → Secrets and variables →
Actions → Variables → New repository variable):

| Name | Value |
|------|-------|
| `R2_BUCKET` | Defaults to `tandem-media` if unset |

---

## 13. App-defined secrets (you create these — no platform)

These aren't from any external service; you invent them.

```env
# Password for the Oracle Admin page (/oracle-admin). Change from the default!
ADMIN_ACCESS_CODE=TANDEM_123

# Signs the admin session cookie + encrypts stored provider API keys.
# Use a long random string and keep it STABLE across restarts
# (changing it makes saved provider keys unreadable).
SESSION_SECRET=<generate: openssl rand -hex 32>
```

---

## 14. Desktop agent configuration

The desktop agent (`artifacts/desktop-agent`) reads its own config from
`tandem-agent.json` next to the app, `~/.tandem-agent/config.json`, or env vars:

| Config / env | Value |
|--------------|-------|
| `TANDEM_API_URL` | Your API base URL, no trailing slash (default `http://localhost:3000`) |
| `TANDEM_CLERK_PUBLISHABLE_KEY` | Same Clerk publishable key as the web apps |
| `TANDEM_FFMPEG_PATH` | Path to the ffmpeg binary (else it uses PATH) |
| `TANDEM_AGENT_WORK_DIR` | Temp dir for staged proxies |
| `TANDEM_UPDATE_URL` | Auto-update feed base URL (where `latest.yml` / `latest-mac.yml` live). Optional — overrides the publish URL baked in at build time. |

The in-app **"Desktop agent for large files"** button (Creator Den vault +
Tandem doorway) shows when the frontend `.env` sets:

```env
VITE_AGENT_DOWNLOAD_URL=https://<public-r2-or-release-url>/desktop-agent/tandem-desktop-agent-latest.exe
```

Optional frontend env (only if the API server runs on a different host than
the socket server):

```env
VITE_SOCKET_URL=https://<api-host>/
```

---

## Checklist — before first full run

- [ ] `.env` created from `.env.example` with at least:
      `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- [ ] DB schema pushed: `DATABASE_URL='…' pnpm --filter db run push-force`
- [ ] `artifacts/tandem/.env`, `artifacts/authors-den/.env`,
      `artifacts/creators-den/.env` each have `VITE_CLERK_PUBLISHABLE_KEY`
- [ ] (Optional) R2: `CF_ACCOUNT_ID`, `CF_R2_BUCKET`, `CF_R2_ACCESS_KEY`,
      `CF_R2_SECRET_KEY`
- [ ] (Optional) AI: `GROQ_API_KEY` / `OPENROUTER_API_KEY` (or Ollama/LM Studio)
- [ ] (Optional) Payments: Clerk Billing enabled + Stripe connected
- [ ] (Optional) CI: GitHub secrets `CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY`,
      `CF_R2_SECRET_KEY` (+ variable `R2_BUCKET`)
