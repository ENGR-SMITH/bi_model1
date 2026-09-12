# PRODUCTION-ENV.md — The credentials behind `NODE_ENV=production`

This guide covers the environment variables you need when the API server runs
in **production mode** (`NODE_ENV=production`). It tells you what each one is
for, where to get the value, and what happens if it's missing.

> **Golden rule:** all of this lives in your `.env` file (repo root or
> `artifacts/api-server/.env`), which is **git-ignored**. Never commit `.env`
> or any of these secrets. Env vars set in the shell or on your hosting
> platform override the `.env` file.
>
> For the complete list of every credential this app uses (including optional
> AI providers, R2, Redis, CI), see `CREDENTIALS.md`.

---

## Quick index

| # | Variable | Where to get it | Required to boot in production? |
|---|----------|-----------------|---------------------------------|
| 1 | `NODE_ENV` | You (set it to `production`) | Yes — it's the switch itself |
| 2 | `PORT` | You (`3000`) | Yes (dev too) |
| 3 | `DATABASE_URL` | Neon / Supabase / local Postgres | Yes |
| 4 | `CLERK_PUBLISHABLE_KEY` | Clerk dashboard | Yes |
| 5 | `CLERK_SECRET_KEY` | Clerk dashboard | Yes (server refuses to boot without it) |
| 6 | `CORS_ORIGINS` | Your deployed frontend origins | Yes — server **refuses to boot** without it |
| 7 | `ADMIN_EMAIL` | Your own email | Yes — server **refuses to boot** without it |
| 8 | `SESSION_SECRET` | Generate with `openssl rand -hex 32` | Yes — must be strong, **non-default** |
| 9 | `WHOP_API_KEY` + `WHOP_ACCOUNT_ID` + `WHOP_PRODUCT_ID` + `WHOP_WEBHOOK_SECRET` | Whop dashboard (see §8) | Required for real payments (simulated checkouts are disabled in production) |
| 10 | `YOUTUBE_OAUTH_CLIENT_ID` + `YOUTUBE_OAUTH_CLIENT_SECRET` (+ `NEXET_WEB_URL`) | Google Cloud Console (see §9) | Required for Creator Den channel linking |

Plus a frontend key for three of the apps: `VITE_CLERK_PUBLISHABLE_KEY`
(section 4). The **Oracle Admin** reads `CLERK_PUBLISHABLE_KEY` from the
repo-root `.env` directly — no per-app file for it.

---

## 1. `NODE_ENV` — the mode switch

**What it is:** tells the server to run as production: CORS allowlist enforced,
admin login fail-closed, simulated card checkouts disabled.

**Value:** `production` (anything else or unset = development).

```env
NODE_ENV=production
```

**Where to set it:** in your `.env`, in the shell before starting the server
(`NODE_ENV=production pnpm --filter @workspace/api-server run start`), or in
your hosting platform's environment variables. Prefer the hosting platform for
a real deploy.

---

## 2. `PORT`

**What it is:** the port the API server listens on.

```env
PORT=3000
```

**Gotcha:** keep it the same port your frontends proxy to and your reverse
proxy forwards to. The server refuses to start without it (dev and prod).

---

## 3. `DATABASE_URL` — PostgreSQL connection string

**What it is:** where the app's data lives (users' subscriptions, promo codes,
provider credentials, everything).

**Where to get it:**
- **Neon** — https://neon.tech → open your project → **Connect** → copy the
  connection string (`postgresql://user:password@ep-xxx...neon.tech/nexet?sslmode=require`).
  Prefer the pooled or direct string for the API server.
- **Supabase** — https://supabase.com → project → **Project Settings →
  Database → Connection string**.
- **Local** — your own PostgreSQL 16+, e.g.
  `postgresql://postgres:<your-password>@localhost:5432/nexet`.

```env
DATABASE_URL=postgresql://user:password@host:5432/nexet
```

**After setting it** (first time only): push the schema:
```bash
DATABASE_URL='<your-connection-string>' pnpm --filter db run push-force
```

---

## 4. Clerk keys — authentication (all apps)

**What they are:** Clerk is the identity provider for every app (Nexet,
Author Den, Creator Den, Oracle Admin) and for the admin magic-link login.

**Where to get them:** https://dashboard.clerk.com → your application →
**API Keys**:
- **Publishable key** — starts with `pk_test_…` (dev) / `pk_live_…` (prod)
- **Secret key** — starts with `sk_test_…` / `sk_live_…`

```env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

**Gotchas:**
- The server mounts Clerk auth **only when `CLERK_SECRET_KEY` is set** — in
  production the admin panel requires it and the server refuses to boot
  without it.
- The **same** publishable key also goes into each frontend app's own `.env`
  at build time (Vite needs it while building):
  ```bash
  # artifacts/nexet/.env
  VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
  # artifacts/authors-den/.env
  VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
  # artifacts/creators-den/.env
  VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
  ```
  The **Oracle Admin** is the exception: its Vite config loads the root `.env`
  (`envDir`), so it uses `CLERK_PUBLISHABLE_KEY` from there with no per-app
  file. Without a key in the root `.env`, the admin page shows a setup hint
  instead of the login form.
- **Admin magic links:** in the Clerk dashboard, enable **User &
  authentication → Email, phone, username → Email → Sign in with email →
  Email verification link**, turn **OFF “Require the same device and
  browser”** (on by default — otherwise the link is rejected unless it is
  opened in the exact browser profile that requested it), and add your
  deployed app origins (including `/oracle-admin/verify`) under **Redirect
  URLs**.
- **Which instance?** Every setting above is per-instance. A freshly created
  instance (or a new production instance you switched to) defaults to **Email
  verification code** only, so the link settings must be enabled again there
  even if the old instance had them.
- **Magic-link error codes.** The admin login now shows Clerk's own error code
  in its message; read that first.
  - `factor_not_found` (“Email link factor not found”) — **Email verification
    link** is not enabled under **Sign-in with email**. The admin page calls
    `signIn.emailLink.sendLink()` directly, so the *link* factor is required;
    the OTP factor alone will not satisfy it.
  - `form_identifier_not_found` — no user with that address on **this**
    instance. Common right after switching instances: the admin account still
    lives on the old one. Create it under **Users**.
  - `client_mismatch` — **Require the same device and browser** is on and the
    link was opened elsewhere.
  - `redirect_url_invalid`, or a link that verifies but never signs in —
    `${origin}/oracle-admin/verify` is missing from the allowed redirect URLs.

---

## 5. `CORS_ORIGINS` — who may call the API

**What it is:** the comma-separated list of origins allowed to make
credentialed requests to the API. In development any origin is reflected; in
production **only this allowlist** is served.

**Where to get it:** the base URLs of your deployed frontends, no trailing
slashes:

```env
CORS_ORIGINS=https://app.yourdomain.com,https://authors.yourdomain.com,https://creators.yourdomain.com,https://admin.yourdomain.com
```

**Gotcha:** the server **refuses to boot in production without this** — a
misconfigured deploy fails fast instead of silently exposing credentialed
responses to any site. Include every origin that talks to the API (web apps,
the admin app, and any tunnel origin you use while testing).

---

## 6. `ADMIN_EMAIL` — who may open the Oracle Admin

**What it is:** the only email allowed into the private admin page
(`/oracle-admin`). Sign-in is a Clerk magic link: type this address, Clerk
emails you a link, click it, you're in. There is **no password** anymore.

**Where to get it:** you invent it — it's the email of whoever operates the
app (it must exist as a Clerk user / receive email).

```env
ADMIN_EMAIL=you@yourdomain.com
```

**Gotcha:** the server **refuses to boot in production without it**. Only this
exact address (case-insensitive) passes the admin gate; every other signed-in
Clerk account is turned away at the door.

---

## 7. `SESSION_SECRET` — encrypts stored provider keys

**What it is:** the secret used to encrypt the model-provider API keys you
save from the Oracle Admin page.

**Where to get it:** generate a long random string — you don't fetch this from
any platform:

```bash
openssl rand -hex 32
```

```env
SESSION_SECRET=<paste the 64-char hex string>
```

**Gotchas:**
- Production **refuses to boot** with the dev default
  (`manuskript-development-key`) or a weak value.
- Keep it **stable across restarts and deploys** — changing it makes the
  stored provider API keys unreadable.

---

## 8. Whop — real payments (four variables)

**What it is:** the Whop credentials for card payments. In production the
simulated "no charge" checkouts (subscriptions, tickets, account quota) return
**403** — paid entitlements can only be granted through Whop webhooks, so these
are what make money move. All four are server-only; never put them in a
frontend `.env`.

**Where to get them** (one-time Whop setup):
1. Create your account + business at **https://whop.com/start** and complete
   activation/KYC (required before live payments and payouts).
2. `WHOP_API_KEY` — **Developer → Account API Keys → Create** → copy the key
   (`whop_…`).
3. `WHOP_ACCOUNT_ID` — **Dashboard → Settings** → Account ID (`biz_…`).
4. `WHOP_PRODUCT_ID` — **Dashboard → Products → Create** → one product
   (`prod_…`) that every subscription plan is mirrored under.
5. `WHOP_WEBHOOK_SECRET` — **Developer → Webhooks → Create webhook**: URL
   `https://<api-host>/api/whop/webhook`, subscribe to `payment.*` and
   `membership.*` events → copy the signing secret (`ws_…`). It is shown
   **only once** at creation — store it immediately.

```env
WHOP_API_KEY=whop_...
WHOP_ACCOUNT_ID=biz_...
WHOP_PRODUCT_ID=prod_...
WHOP_WEBHOOK_SECRET=ws_...
```

**Webhook:** Whop signs every webhook with HMAC-SHA256 over the raw body
(Standard Webhooks spec, `webhook-id`/`webhook-timestamp`/`webhook-signature`
headers) keyed by `WHOP_WEBHOOK_SECRET` — that is the only webhook secret.
For development use the **sandbox** environment (sandbox.whop.com, its own
keys) so no real money moves; swap in live keys for production.

---

## 9. YouTube channel linking — Google Cloud setup (Creator Den)

**What it is:** a Creator Den channel owner links their own YouTube channel,
and the API syncs channel + per-video analytics using the stored (encrypted)
refresh token. These are server-only credentials — never put them in a
frontend `.env`.

**Where to get them:** https://console.cloud.google.com → the **same project
that owns the OAuth client** (check the project selector, top left):

1. **Enable both APIs** — **APIs & Services → Library**, search and **Enable**:
   - **YouTube Data API v3** — used by `youtube/v3/channels`,
     `/playlistItems`, `/videos`
   - **YouTube Analytics API** — used by `youtubeAnalytics/v2/reports`

   Enabling them on a *different* project than the OAuth client is the classic
   miss: they look enabled, but not where it counts. While the OAuth consent
   screen is in **Testing**, also make sure the Google account you sign in with
   is listed under **OAuth consent screen → Test users**.
2. **Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized redirect URI** (byte-for-byte, no trailing slash):
     `https://<your-domain>/creators-den/channels/oauth/callback`
     (local dev: `http://localhost:5175/creators-den/channels/oauth/callback`)
   - **Authorized JavaScript origin**: your web origin, e.g. `https://nexet.co`

```env
YOUTUBE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
YOUTUBE_OAUTH_CLIENT_SECRET=GOCSPX-...
YOUTUBE_REDIRECT_URI=https://nexet.co/creators-den/channels/oauth/callback
NEXET_WEB_URL=https://nexet.co            # derives the redirect URI when it is unset
```

**Gotchas:**
- `YOUTUBE_REDIRECT_URI` falls back to
  `${NEXET_WEB_URL}/creators-den/channels/oauth/callback`. In production a
  loopback fallback is **refused at start** rather than sending Google a URI it
  can never have registered (`redirect_uri_mismatch`).
- Stray surrounding quotes and whitespace are stripped from the env values, but
  Google still matches the rest **byte-for-byte**.
- Linking is bound to `mine=true`, so the consenting Google account must
  **own** the channel — a brand channel has to be selected on the consent
  screen.
- The PKCE verifier travels inside the sealed `state` token, so the callback
  survives a restart, a spin-down, or landing on a second instance.

**Error reasons → what to do.** The connect card (and the API logs) show
Google's own `errors[0].reason`:

| Google reason | Meaning / fix |
|---|---|
| `accessNotConfigured`, `SERVICE_DISABLED` | **YouTube Data API v3** is not enabled on the project the OAuth client belongs to. Enable it under APIs & Services → Library. |
| `youtubeSignupRequired` | That Google account has no YouTube channel. Sign in with the account — or its brand channel — that owns the channel you want to link. |
| `quotaExceeded`, `dailyLimitExceeded`, `rateLimitExceeded` | The project's Data API quota is spent. Wait for the reset, or raise it under APIs & Services → Quotas. |
| `insufficientPermissions`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | YouTube access was not granted on the consent screen. Disconnect, then reconnect and accept the permission. |
| `invalid_grant` (token endpoint) | The stored refresh token is dead — the link is marked `REVOKED` and the UI offers Reconnect. |
| `redirect_uri_mismatch` (token endpoint) | The URI sent is not registered on the OAuth client — compare `YOUTUBE_REDIRECT_URI` character by character. |

---

## Before you flip the switch — checklist

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...            # section 3
CLERK_PUBLISHABLE_KEY=pk_live_...        # section 4
CLERK_SECRET_KEY=sk_live_...             # section 4
CORS_ORIGINS=https://...                 # section 5 — all deployed origins
ADMIN_EMAIL=you@yourdomain.com           # section 6
SESSION_SECRET=<openssl rand -hex 32>    # section 7 — strong, stable
WHOP_API_KEY=whop_...                    # section 8 — if taking payments
WHOP_ACCOUNT_ID=biz_...
WHOP_PRODUCT_ID=prod_...
WHOP_WEBHOOK_SECRET=ws_...
```

- [ ] `.env` has every required variable above
- [ ] the three frontend `.env` files have `VITE_CLERK_PUBLISHABLE_KEY` (Oracle Admin reads `CLERK_PUBLISHABLE_KEY` from the root `.env`)
- [ ] DB schema pushed (`pnpm --filter db run push-force`)
- [ ] Whop webhook URL points at `/api/whop/webhook`
- [ ] Clerk dashboard: email verification link enabled + redirect URLs added
- [ ] Google Cloud: **YouTube Data API v3** + **YouTube Analytics API** enabled on the OAuth client's project, and the redirect URI registered (section 9)
- [ ] Deployed origins all listed in `CORS_ORIGINS`

**If anything required is missing, the server tells you at boot** — it exits
with a message naming the missing variable, so a bad deploy fails loudly, not
silently.