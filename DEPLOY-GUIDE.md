# 🚀 Complete Deployment Guide — Nexet on Render

> Verified against the repo: Dockerfile, nginx config, entrypoint, env requirements, Supabase schema, and Redis/BullMQ wiring.

## What you're deploying

One **Render Web Service (Docker)** that runs **nginx + your Node API server in a single container**:
- nginx on port **8080** serves all 4 apps: Nexet `/`, Author Den `/authors-den/`, Creator Den `/creators-den/`, Oracle Admin `/oracle-admin/`
- Node on port **3000** runs the API, Socket.IO realtime, and (if Redis is off) the video worker
- Your **Supabase** Postgres is the database, **Upstash Redis** (your `rediss://` URL) is the job queue

---

## PHASE 1 — Before you touch Render (30–60 min)

### Step 1.1 — Generate a strong SESSION_SECRET
Open a terminal on your PC and run:
```bash
openssl rand -hex 32
```
Copy the 64-character output somewhere safe. **You'll paste it into Render later.** ⚠️ Never reuse `manuskript-development-key` in production — the app refuses to boot with it.

### Step 1.2 — Get your Clerk production keys
1. Go to **dashboard.clerk.com** → your instance → **API Keys**
2. Copy the **Publishable key** (starts `pk_live_` for production)
3. Copy the **Secret key** (starts `sk_live_`)

> ⚠️ If your Clerk instance only has `pk_test_` keys, you must switch it to **Production** mode in Clerk first (it will create `pk_live_` / `sk_live_` keys). The app can technically boot with test keys, but real users can't sign in.

### Step 1.3 — Get your Paystack production key (if selling subscriptions)
**Paystack Dashboard → Settings → API Keys & Webhooks** → copy the **Secret key** (`sk_live_...`). Only needed if you want real payments on day one.

### Step 1.4 — Confirm your Supabase database (already done ✅)
Your `DATABASE_URL` (the Supabase pooler one) is verified working, and the schema is **already pushed** — all 59 tables renamed to `nexet_*`. Nothing to do here.

### Step 1.5 — Confirm your Redis (already done ✅)
Your Upstash `rediss://...` URL is verified working. Keep it handy — you'll paste it into Render.

### Step 1.6 — Decide about video storage (read this carefully)
Your video pipeline needs durable storage. You have two choices:

| Choice | What to do |
|---|---|
| **A. Cloudflare R2** (recommended) | Use your existing `CF_*` keys + bucket `tandem-media`. Videos live in the bucket forever, survive redeploys. |
| **B. No R2** | You MUST add a **Render Disk** and set `VIDEO_UPLOAD_DIR=/var/data/uploads` — otherwise every upload is erased on each redeploy. |

You have `CF_ACCOUNT_ID`, `CF_R2_BUCKET`, `CF_R2_ACCESS_KEY`, `CF_R2_SECRET_KEY` in your `.env` — so **Option A** is ready. (Also add the Render Disk as a safety net regardless — it's cheap.)

---

## PHASE 2 — Create the Render service (15 min)

### Step 2.1 — Create a new Web Service
1. Go to **render.com** → **New** → **Web Service**
2. Connect your GitHub repo (`harkinsadrianna216-alt/bi_model1__v5`)
3. Select the repo → **Connect**

### Step 2.2 — Configure the service (IMPORTANT — exact values)
| Field | Value |
|---|---|
| **Environment** | `Docker` (NOT Node!) |
| **Name** | `nexet` (or anything) |
| **Region** | Nearest to your users (e.g. `Frankfurt (EU Central)` — your Supabase pooler is `aws-0-eu-west-2`) |
| **Branch** | `main` |
| **Root Directory** | *(leave empty — the Dockerfile needs the whole repo)* |
| **Dockerfile Path** | `artifacts/api-server/Dockerfile` |
| **Instance Type** | `Starter` (512 MB) to start; upgrade later |
| **Auto-Deploy** | `Yes` |

### Step 2.3 — Add ALL environment variables
Click **Advanced** → **Add Environment Variable**. Paste **every value** from your local `.env` — **but change these first**:

```
NODE_ENV=production
PORT=8080
DATABASE_URL=<your supabase url — same as local>
CORS_ORIGINS=https://app.YOURDOMAIN.com,https://authors.YOURDOMAIN.com,https://creators.YOURDOMAIN.com,https://admin.YOURDOMAIN.com
CLERK_PUBLISHABLE_KEY=pk_live_...          (REQUIRED — build arg)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...     (REQUIRED — build arg, same key)
CLERK_SECRET_KEY=sk_live_...
ADMIN_EMAIL=<the email that opens Oracle Admin>
SESSION_SECRET=<the 64-char hex from Step 1.1>
REDIS_URL=rediss://default:gQAAAAAAA2EJAAIgcDJhM2ZhNjU5NDMwNmQ0ZTI5ODJlMWNhZmFkZDFiNzFlYw@eternal-polecat-221449.upstash.io:6379
NEXET_WEB_URL=https://app.YOURDOMAIN.com
PAYSTACK_SECRET_KEY=sk_live_...            (if enabling payments)
CF_ACCOUNT_ID=<your value>
CF_R2_BUCKET=tandem-media
CF_R2_ACCESS_KEY=<your value>
CF_R2_SECRET_KEY=<your value>
YOUTUBE_OAUTH_CLIENT_ID=<your value>        (optional)
YOUTUBE_OAUTH_CLIENT_SECRET=<your value>    (optional)
YOUTUBE_REDIRECT_URI=https://app.YOURDOMAIN.com/creators-den/channels/oauth/callback
```

Also add these optional/tuning vars from your `.env`: `LOG_LEVEL`, `YT_*` values, `ORIGINAL_RETENTION_DAYS`, `STORAGE_METER_INTERVAL_HOURS`, `STORAGE_RETENTION_INTERVAL_HOURS`, and any `GROQ_*`/`OPENROUTER_*`/`FREEBUFF_*` AI provider keys.

**⚠️ Important notes:**
- `PORT=8080` **overrides Render's default** (`10000`) — nginx listens on 8080. Don't skip this.
- Don't bother setting: `PAYSTACK_PUBLIC_KEY`, `ADMIN_ACCESS_CODE`, `ANON_PUBLIC`, `SERVICE_ROLE`, or the desktop-agent `NEXET_*` vars — the web app doesn't read them (harmless if you do anyway).
- Replace `YOURDOMAIN.com` with your real domain in `CORS_ORIGINS` and `NEXET_WEB_URL` (or use Render's `https://<service>.onrender.com` URL temporarily).

### Step 2.4 — Add a Disk (do this regardless — safety net)
1. In the service → **Disks** tab → **Add Disk**
2. Mount path: `/var/data`, size: `1 GB` (start small)
3. Add env var: `VIDEO_UPLOAD_DIR=/var/data/uploads`

### Step 2.5 — Deploy
Click **Create Web Service**. Render will build the Docker image (takes 5–10 min on first deploy). Watch the **Deploy logs** — a green `Live` means success.

---

## PHASE 3 — The Redis worker fleet (CRITICAL — do not skip)

Because you're enabling `REDIS_URL`, the API server **stops processing video jobs itself** — BullMQ hands them to a **worker process** that must run separately. Without this step, uploads will queue forever and never process.

### Create a Background Worker service
1. **Render → New → Background Worker**
2. Same repo, same Dockerfile (`artifacts/api-server/Dockerfile`)
3. **Start Command**:
```
node ./artifacts/api-server/dist/workers/all.mjs
```
4. **Same env vars** as the Web Service (`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CLERK_*`, `CF_*`, `VIDEO_UPLOAD_DIR` — everything except `PORT` and the Clerk build args)
5. Same Disk (mount `/var/data`)
6. **Create** — it will start the worker for all 10 job queues (`nexet-video-*`)

> Verified working: your Redis accepts the connection and all 10 queues start.

---

## PHASE 4 — Connect the external services to your live domain

### Step 4.1 — Clerk
1. Get your Render URL (e.g. `https://nexet.onrender.com`)
2. **Clerk Dashboard → your instance → Domains/Redirect URLs**
3. Add as allowed origins / redirect URLs:
   - `https://nexet.onrender.com`
   - `https://app.YOURDOMAIN.com` (once custom domain is live)
4. **Clerk → Email → Templates**: your sign-in emails will now come from your live app

### Step 4.2 — Paystack (if enabled)
**Paystack Dashboard → Settings → Webhooks** → set URL:
```
https://app.YOURDOMAIN.com/api/paystack/webhook
```
(Or the Render URL until your domain is live.)

### Step 4.3 — Custom domain (recommended)
1. **Render → your Web Service → Settings → Custom Domain** → add `app.YOURDOMAIN.com`
2. Follow Render's DNS instructions (add a CNAME record at your DNS provider)
3. After it's live, update `CORS_ORIGINS` + `NEXET_WEB_URL` to the real domain and redeploy

### Step 4.4 — Google/YouTube OAuth (if using Creator Den channels)
Add `https://app.YOURDOMAIN.com/creators-den/channels/oauth/callback` to your Google Cloud **Authorized redirect URIs**, and your domain to **Authorized JavaScript origins**.

---

## PHASE 5 — Post-deploy verification (do this before telling anyone)

| Check | How |
|---|---|
| All 4 apps load | Visit `/`, `/authors-den/`, `/creators-den/`, `/oracle-admin/` — all should show the app, not errors |
| Sign-in works | Click sign-in on Nexet — should redirect to Clerk and come back signed in |
| Oracle Admin opens | Sign in with your `ADMIN_EMAIL` — magic link arrives in your inbox |
| Upload a test video | Create a Creator Den project, upload a file → should appear with a PROXY job running |
| Job completes | Watch the job go `QUEUED → RUNNING → SUCCEEDED` in the vault (proves Redis + worker + ffmpeg work end-to-end) |
| Real-time works | Open two browsers, add a comment — should appear live via Socket.IO |
| Worker logs | Render → Background Worker → logs should show no Redis errors |

---

## 🔧 What to do if something fails

| Symptom | Fix |
|---|---|
| **Deploy fails at build** | Missing `CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_PUBLISHABLE_KEY` build args → add them to service env |
| **Container boots then exits** | Read the log — the app fails closed with a message. Usually missing `CORS_ORIGINS`, `ADMIN_EMAIL`, or weak `SESSION_SECRET` |
| **API returns 500 "Publishable key not valid"** | Your Clerk key is a placeholder/test key — use `pk_live_` |
| **Uploads stuck in QUEUED** | Worker service isn't running → create the Background Worker (Phase 3) |
| **Sign-in doesn't complete** | Clerk origins/redirect URLs don't include your deployed domain → update in Clerk dashboard |
| **Uploads disappear after redeploy** | No R2 + no Disk → add the Render Disk and set `VIDEO_UPLOAD_DIR` |