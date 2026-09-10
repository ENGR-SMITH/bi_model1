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
| 2 | Neon / Supabase (or local Postgres) | `DATABASE_URL` | Database | **Yes** |
| 3 | Cloudflare R2 | Account ID + bucket + Access/Secret keys | Video proxies/exports/bundles storage | For R2 storage |
| 4 | Groq | `GROQ_API_KEY` | Story Oracle AI (fast hosted models) | No (optional AI) |
| 5 | OpenRouter | `OPENROUTER_API_KEY` | Story Oracle AI (multi-model) | No (optional AI) |
| 6 | Ollama | Nothing (local) | Local AI inference | No |
| 7 | LM Studio | Nothing (local) | Local AI inference | No |
| 8 | Freebuff | `FREEBUFF_API_KEY` | Model gateway AI | No (optional AI) |
| 9 | Redis (Upstash/Redis Cloud/local) | `REDIS_URL` | BullMQ video job queue | No (optional) |
| 10 | GitHub | Secrets + vars | CI build of the desktop agent | For CI |
| 11 | Whop | `WHOP_API_KEY`, `WHOP_ACCOUNT_ID`, `WHOP_PRODUCT_ID`, `WHOP_WEBHOOK_SECRET` | USD card payments for subscriptions (hosted checkout + webhooks) | For real payments |

App-defined secrets (not from a platform — you create them):
`ADMIN_EMAIL`, `SESSION_SECRET` — see section 12.

---

## 1. Clerk — authentication (all apps)

**Platform:** https://dashboard.clerk.com

Clerk is the identity provider. One Clerk instance serves Nexet, Creator Den,
and Author Den. Every app uses the **same** publishable key; the API server
uses the same secret key.

**Step-by-step:**

1. Go to https://dashboard.clerk.com and sign up / log in.
2. Click **Create application**. Name it (e.g. `nexet`), pick your sign-in
   methods (email, Google, etc.), and create it.
3. On the application's home page you'll see two keys under **API Keys**:
   - **Publishable key** — starts with `pk_test_…` (or `pk_live_…` in prod)
   - **Secret key** — starts with `sk_test_…` (or `sk_live_…` in prod)
4. Click the eye / **Copy** buttons to copy each.

**Also enable email links** (needed for the Oracle Admin's magic-link login):
under **User & authentication → Email, phone, username → Email**, enable
**Sign in with email** and **Email verification link**. If you want to allow
new addresses to receive links, also enable **Sign up with email** →
**Verify at sign-up** → **Email verification link**.

**Then turn OFF “Require the same device and browser”** (it is on by
default, directly under the email verification link strategy). When it is
on, the link can only be opened in the exact same browser profile that
requested it — an incognito window, a different browser, or an in-app mail
browser is rejected with “Open the link on the same device”. Turning it
off gives the Slack/Notion-style flow: request the link anywhere, click it
anywhere, and the browser that clicks the link gets signed in.

**Where they go:**

```env
# root .env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

And in **each frontend app's** own `.env` file (Vite apps need the publishable
key at build time):

```bash
# artifacts/nexet/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# artifacts/authors-den/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...

# artifacts/creators-den/.env
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

The **Oracle Admin** (`artifacts/oracle-admin`) is the exception — its Vite
config loads the repo-root `.env` (`envDir`), so it reads
`CLERK_PUBLISHABLE_KEY` straight from there and needs **no** per-app `.env`
file.

> Test mode keys (`_test_`) are for development. When you go live, switch
> every app to the same `_live_` keys (from the Clerk dashboard → **Production**
> instance) and update the three files (the admin app follows the root `.env`
> automatically).

---

## 2. Database — PostgreSQL

**Platform (hosted):** https://neon.tech or https://supabase.com
**Platform (local):** your own machine (PostgreSQL 16+)

**Step-by-step — Neon (recommended hosted option):**

1. Go to https://neon.tech and sign up (free tier is fine).
2. Click **Create a project**, name it (e.g. `nexet`), pick a region.
3. On the project dashboard click **Connect**.
4. Copy the **connection string** — it looks like:
   `postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/nexet?sslmode=require`
   Use the **pooled** or **direct** string as you prefer.

**Where it goes:**

```env
DATABASE_URL=postgresql://user:password@host:5432/nexet
```

**Local alternative:** install PostgreSQL 16+ on your machine, create a
`nexet` database, and use:
`postgresql://postgres:<your-password>@localhost:5432/nexet`

**After setting it:** push the schema once (from repo root):
```bash
DATABASE_URL='<your-connection-string>' pnpm --filter db run push-force
```

---

## 3. Cloudflare R2 — video file storage

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

## 4. Groq — Story Oracle AI (fast hosted models)

**Platform:** https://console.groq.com

**Step-by-step:**

1. Go to https://console.groq.com and sign up.
2. Open **API Keys** in the left sidebar.
3. Click **Create API Key**, give it a name, copy the key (starts `gsk_…`).

```env
GROQ_API_KEY=gsk_...
```

---

## 5. OpenRouter — Story Oracle AI (multi-model)

**Platform:** https://openrouter.ai

**Step-by-step:**

1. Go to https://openrouter.ai and sign up.
2. Click your avatar → **Keys**.
3. Click **Create Key**, copy it (starts `sk-or-v1-…`).

```env
OPENROUTER_API_KEY=sk-or-v1-...
```

---

## 6. Ollama — local AI (no key)

**Platform:** https://ollama.com (download) — runs on your own machine.

No API key. Install Ollama, then pull a model (e.g. `ollama pull llama3.2`).
The app only needs the base URL:

```env
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL_ID=llama3.2
```

---

## 7. LM Studio — local AI (no key)

**Platform:** https://lmstudio.ai (download) — runs on your own machine.

No API key. Start the local server (LM Studio → **Developer** → **Local
server**). The app only needs the base URL:

```env
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL_ID=local-model
```

---

## 8. Freebuff — model gateway

**Platform:** https://freebuff.com (the product you're using).

```env
FREEBUFF_API_KEY=
FREEBUFF_BASE_URL=http://localhost:8081/v1
FREEBUFF_MODEL_ID=deepseek-v4-flash
```

(Optional — the key can also be entered in the Oracle Admin page.)

---

## 9. Redis — video job queue (optional)

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

## 10. GitHub — CI secrets & vars (for the desktop-agent installer)

**Platform:** https://github.com

The CI workflow (`.github/workflows/build-desktop-agent.yml`) builds the
Windows `.exe` / macOS `.dmg` and publishes it to R2 on an `agent-v*` tag.
It needs these as **repository secrets** (Settings → Secrets and variables →
Actions → New repository secret):

| Name | Value |
|------|-------|
| `CF_ACCOUNT_ID` | Your Cloudflare account ID (section 3) |
| `CF_R2_ACCESS_KEY` | Your R2 Access Key ID (section 3) |
| `CF_R2_SECRET_KEY` | Your R2 Secret Access Key (section 3) |

And optionally a **repository variable** (Settings → Secrets and variables →
Actions → Variables → New repository variable):

| Name | Value |
|------|-------|
| `R2_BUCKET` | Defaults to `tandem-media` if unset |

---

## 11. Whop — real payments (USD), hosted checkout

**Platform:** https://whop.com (dashboard at whop.com/dashboard)

Real card charging for subscriptions runs through **Whop** (hosted checkout:
the server mirrors each catalog plan as a Whop renewal plan, opens a checkout
configuration, the customer pays on Whop's page, and a webhook grants the
entitlement). Four credentials are needed:

**Step-by-step:**

1. Create your Whop account + business at **whop.com/start** and complete
   activation/KYC — required before live payments and payouts.
2. **`WHOP_API_KEY`** — Dashboard → **Developer → Account API Keys → Create**
   (name it e.g. "Nexet production") → copy the key (`whop_…`). Start with the
   Admin role; narrow to the exact permissions the app uses later.
3. **`WHOP_ACCOUNT_ID`** — Dashboard → **Settings** → Account ID (`biz_…`).
4. **`WHOP_PRODUCT_ID`** — Dashboard → **Products → Create product** (`prod_…`);
   every subscription plan is mirrored under it, and its title shows on the
   Whop checkout page.
5. **`WHOP_WEBHOOK_SECRET`** — Dashboard → **Developer → Webhooks → Create
   webhook**: URL `https://<api-host>/api/whop/webhook`, subscribe to the
   `payment.*` and `membership.*` events → copy the signing secret (`ws_…`).
   It is shown **ONLY ONCE** at creation — store it immediately. Whop signs
   webhooks with HMAC-SHA256 over the raw body (Standard Webhooks spec); this
   secret is the verification key.

**Where it goes (all server-only — never in a frontend .env):**

```env
WHOP_API_KEY=whop_...
WHOP_ACCOUNT_ID=biz_...
WHOP_PRODUCT_ID=prod_...
WHOP_WEBHOOK_SECRET=ws_...
```

> **Sandbox:** Whop has a separate sandbox environment (sandbox.whop.com) with
> its own keys and test cards — use it for development so no real money moves,
> then swap in the live keys for production. Live fees: 2.7% + $0.30 per
> transaction (domestic cards), +1.5% international cards, +1% currency
> conversion.

---

## 12. App-defined settings (you create these — no platform)

These aren't from any external service; you create them.

```env
# The email that may open the Oracle Admin page (/oracle-admin). Sign-in is a
# Clerk magic link (the Slack/Notion flow): enter this address on the admin
# login page, Clerk emails you a link, click it, and you're in — no password
# to create, remember, or lose. Set it to the email of whoever runs the app.
ADMIN_EMAIL=you@yourdomain.com

# Encrypts the provider API keys stored by the Oracle Admin.
# Use a long random string and keep it STABLE across restarts
# (changing it makes saved provider keys unreadable).
SESSION_SECRET=<generate: openssl rand -hex 32>
```

**How the Oracle Admin login works** — there is **no shared access code
anymore** (the old `ADMIN_ACCESS_CODE` login was removed). Instead:

1. Open `/oracle-admin` and type your admin email → **Email me a sign-in link**.
2. Clerk emails a magic link to that address. Click it.
3. The server opens the control room only when the signed-in Clerk user's
   email matches `ADMIN_EMAIL` exactly — every other signed-in account is
   turned away at the door.

Clerk does the emailing, so **no SMTP/email provider is needed**. Two Clerk
Dashboard settings make the link flow work:

- **User & authentication → Email, phone, username → Email**: enable
  **Sign in with email** + **Email verification link** (see section 1), and
  turn **OFF “Require the same device and browser”** so the link works from
  any browser, not just the one that requested it.
- **User & authentication → Redirect URLs**: allow the admin app's origin and
  its verify route, e.g. `http://localhost:5176` and
  `http://localhost:5176/oracle-admin/verify` in dev (the exact production
  URL once deployed).

The admin app reads `CLERK_PUBLISHABLE_KEY` straight from the repo-root
`.env` (its Vite config loads it via `envDir`), so no separate
`artifacts/oracle-admin/.env` is needed. Without a key in the root `.env` the
admin page shows a setup hint instead of the login form.

> **Upgrading from the access code:** remove `ADMIN_ACCESS_CODE` from any
> `.env` copied from an older template and add `ADMIN_EMAIL`. In production
> the server refuses to boot without `ADMIN_EMAIL`, a strong `SESSION_SECRET`,
> and `CLERK_SECRET_KEY` — the admin panel fails closed instead of open.

---

## 13. Desktop agent configuration

The desktop agent (`artifacts/desktop-agent`) reads its own config from
`nexet-agent.json` next to the app, `~/.nexet-agent/config.json`, or env vars:

| Config / env | Value |
|--------------|-------|
| `NEXET_API_URL` | Your API base URL, no trailing slash (default `http://localhost:3000`) |
| `NEXET_CLERK_PUBLISHABLE_KEY` | Same Clerk publishable key as the web apps |
| `NEXET_FFMPEG_PATH` | Path to the ffmpeg binary (else it uses PATH) |
| `NEXET_AGENT_WORK_DIR` | Temp dir for staged proxies |
| `NEXET_UPDATE_URL` | Auto-update feed base URL (where `latest.yml` / `latest-mac.yml` live). Optional — overrides the publish URL baked in at build time. |

The in-app **"Desktop agent for large files"** button (Creator Den vault +
Nexet doorway) shows when the frontend `.env` sets:

```env
VITE_AGENT_DOWNLOAD_URL=https://<public-r2-or-release-url>/desktop-agent/nexet-desktop-agent-latest.exe
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
- [ ] `artifacts/nexet/.env`, `artifacts/authors-den/.env`,
      `artifacts/creators-den/.env` each have `VITE_CLERK_PUBLISHABLE_KEY`
- [ ] (Optional) R2: `CF_ACCOUNT_ID`, `CF_R2_BUCKET`, `CF_R2_ACCESS_KEY`,
      `CF_R2_SECRET_KEY`
- [ ] (Optional) AI: `GROQ_API_KEY` / `OPENROUTER_API_KEY` (or Ollama/LM Studio)
- [ ] (Optional) Payments: `WHOP_API_KEY` + `WHOP_ACCOUNT_ID` + `WHOP_PRODUCT_ID` + `WHOP_WEBHOOK_SECRET` set (sandbox or live — section 11)
- [ ] (Optional) CI: GitHub secrets `CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY`,
      `CF_R2_SECRET_KEY` (+ variable `R2_BUCKET`)
