# Whop (USD) — Subscription Payment Integration Plan

Status: **implemented** · Gateway: **Whop** · Currency: **USD only**

Reference doc for the app's subscription payments, which run through **Whop**
(hosted checkout + native renewal plans). The customer pays on Whop's page and
**no card data ever touches our code** (removes PCI scope). Whop mirrors each
catalog plan as a renewal plan, charges it every 30 days on its own, and fires
`payment.succeeded` per cycle; our server grants the entitlement from the
webhook (or the post-redirect confirm) exactly once.

Products being paid for (all prices in **USD cents**; Whop prices in dollars —
converted at the API boundary with a ÷100 / ×100):

| Product | Plans | Current price |
|---|---|---|
| NEXET category passes (`pass`) | `authors`, `content-creators` | 188¢ ($1.88) / 3 weeks |
| Creator Den storage (`storage`) | `g200`, `g500`, `tb1` | 2000¢ / 5000¢ / 6000¢ |
| Author Den projects (`projects`) | `p10`, `p50`, `p200` | 500¢ / 2000¢ / 5000¢ |

---

## 1. Credentials — what to get from Whop

Everything lives in the **Whop dashboard** (whop.com/dashboard). Four server-only
values:

| Env var | Value | Notes |
|---|---|---|
| `WHOP_API_KEY` | `whop_…` (sandbox or live) | **Account API key** — Developer → Account API Keys → Create. Sent as `Authorization: Bearer` on every server→Whop call. Start with Admin role; narrow later. |
| `WHOP_ACCOUNT_ID` | `biz_…` | Dashboard → Settings → Account ID. Required by the plans + checkout-configuration endpoints. |
| `WHOP_PRODUCT_ID` | `prod_…` | Dashboard → Products → one product all subscription plans are mirrored under. |
| `WHOP_WEBHOOK_SECRET` | `ws_…` | Developer → Webhooks → Create webhook (URL `https://<api-host>/api/whop/webhook`, events `payment.*` + `membership.*`). **Shown only once at creation** — store immediately. Verifies webhook signatures (Standard Webhooks, HMAC-SHA256). |

- **No extra webhook secret beyond `ws_…`.** Whop signs every webhook with
  HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw body}` keyed by this
  secret (Standard Webhooks spec) — the `webhook-signature` header is
  `v1,<base64>`, and the timestamp must be within 5 minutes (replay guard).
- Keys live in the repo-root `.env` (api-server loads `.env` on boot via
  `artifacts/api-server/src/env.ts`). Add all four to `.env.example`,
  `CREDENTIALS.md`, and `PRODUCTION-ENV.md`.

### Sandbox first

Whop has a separate **sandbox environment** (sandbox.whop.com) with its own
keys and test cards (success / failed / requires-action outcomes). Develop
against sandbox keys so no real money moves; swap in live keys for production.
Sandbox and live keys look identical, so keep them under different env var
names when switching.

---

## 2. URLs to add on the Whop dashboard

| URL | Where | Value |
|---|---|---|
| **Webhook URL** (required) | Developer → Webhooks | `https://<your-api-host>/api/whop/webhook` |
| **Return URL** (per checkout, optional) | Passed in the checkout configuration at checkout time | Each app's own page, e.g. `https://app.nexet.com/subscriptions` — the customer lands back there after paying. |

---

## 3. Overall flow

```
[Browser]                    [Your API server]                    [Whop]
    │ POST /api/whop/checkout {kind, planId, promoCode}                │
    │──────────────────────────────▶│                                  │
    │                               │ resolve price+promo, mint        │
    │                               │ reference (whp_<uuid>), save     │
    │                               │ intent PENDING                   │
    │                               │ get-or-create renewal plan       │
    │                               │ POST /plans                      │
    │                               │──────────────────────────────────▶│
    │                               │◀────────── {id, purchase_url}    │
    │                               │ POST /checkout_configurations    │
    │                               │  {plan_id, redirect_url,         │
    │                               │   metadata:{reference,…}}        │
    │                               │──────────────────────────────────▶│
    │                               │◀────────── {purchase_url}        │
    │◀────── 200 {checkoutUrl, reference}                               │
    │ redirect (window.location)    │                                  │
    │──────────────────────────────────────────────────────────────────▶│
    │                           customer pays on Whop page             │
    │ (a) redirect back ──── redirect_url ──▶ browser page calls        │
    │     POST /api/whop/confirm {reference}                            │
    │ (b) webhook ────── payment.succeeded ──▶ POST /api/whop/webhook   │
    │                               │──────────────────────────────────▶│
    │                               │ verify (Standard Webhooks sig)    │
    │                               │ grant entitlement (once, by ref)  │
```

Two paths converge on one idempotent **grant-by-reference** function:

- **Webhook** (`payment.succeeded`, always fired by Whop) = source of truth;
  covers users who close the tab mid-payment.
- **Confirm** (triggered by the return redirect) = instant UI feedback; the
  route checks the intent status the webhook flipped (SUCCESS → receipt,
  FAILED → error, PENDING → "still confirming"). Grant is idempotent.

---

## 4. API endpoints

### 4.1 `POST /api/whop/checkout` — Clerk auth required

File: `artifacts/api-server/src/routes/whop.ts`, mounted in
`artifacts/api-server/src/routes/index.ts`. Accepts **no card** — only
`{ kind, planId, promoCode?, callbackUrl? }`.

Steps:
1. Resolve product + price + promo (reuse `subscriptionPlans`, `planPrice`,
   `resolvePromo`, `PASS_PRICE_USD` — the math that exists today).
2. FREE promo → grant immediately server-side (no charge, no membership).
3. Get-or-create the Whop renewal plan (`nexet_whop_plans` caches
   `plan_…` per kind+planId):
   ```ts
   const { whopPlanId } = await createPlan({
     title: `${planLabel} (Monthly)`,
     amountCents: total,           // 588 for $5.88/mo
     billingPeriodDays: 30,
   });
   // POST /plans → { plan_type: "renewal", renewal_price: total/100, billing_period: 30, currency: "usd" }
   ```
4. Mint a server-side reference: `whp_${randomUUID()}` and save a **PENDING**
   intent row (`nexet_whop_intents`).
5. Open the hosted checkout:
   ```ts
   const { purchaseUrl } = await createCheckout({
     planId: whopPlanId,
     redirectUrl: callbackUrl,     // where Whop sends the customer after paying
     metadata: { reference, customer_email, userId, kind, planId, promoCode? },
   });
   // POST /checkout_configurations → { id: ch_…, purchase_url }
   ```
6. Respond `{ checkoutUrl: purchaseUrl, reference }`.

### 4.2 `POST /api/whop/webhook` — no auth, raw JSON body

- Verify the Standard Webhooks signature: HMAC-SHA256 over
  `{webhook-id}.{webhook-timestamp}.{raw body}` keyed by `WHOP_WEBHOOK_SECRET`,
  `v1,<base64>` in `webhook-signature`, timestamp within 5 minutes (raw-body
  capture lives in `app.ts`).
- `payment.succeeded` → grant by `metadata.reference` (first purchase) or by
  `membership.id` (recurring cycle → `grantSubscriptionCharge`).
- `payment.failed` → mark the intent FAILED (or set `renewalFailure` on the
  live subscription for declined renewals).
- `membership.deactivated` → stop treating the chain as auto-renewing.
- Always answer fast with `200 { received: true }`.

### 4.3 `POST /api/whop/confirm` — Clerk auth required

Called by the frontend return page when it sees `?reference=` on mount
(we embed it in the Whop redirect_url). Looks up the intent, checks ownership,
then:
- `SUCCESS` → `{ granted: true, receipt: { total, cardLast4, promoCode } }`
- `FAILED` → not granted with a friendly message
- `PENDING` → not granted with "still confirming" — the webhook will complete
  the grant momentarily.

---

## 5. Webhook signature verification (raw body)

`app.ts` runs `express.json()` globally **before** routes, which consumes the
body — but the HMAC is computed over the raw bytes. Capture the buffer during
parsing (already in place):

```ts
app.use(express.json({ verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } }));
```

Then in the webhook route (see `artifacts/api-server/src/lib/whop.ts` →
`whopSignatureValid`):

```ts
const raw = String(req.rawBody ?? "");
const headers = req.headers; // webhook-id, webhook-timestamp, webhook-signature (v1,<base64>)
if (!whopSignatureValid(raw, headers)) { res.status(401).json({ error: "Invalid signature" }); return; }
const event = req.body; // { type: "payment.succeeded", data: { id, total, currency, metadata, … } }
```

---

## 6. Idempotency — `nexet_whop_intents` table

Webhooks can arrive twice, and the confirm path races the webhook. The intent
table (`lib/db/src/schema/whop-intents.ts`) keys by the minted reference:

```
nexet_whop_intents:
  reference          text PRIMARY KEY -- whp_<uuid>, minted server-side
  user_id            text NOT NULL
  kind               text NOT NULL    -- pass | storage | projects
  plan_id            text NOT NULL
  plan_label         text NOT NULL
  interval_label     text NOT NULL DEFAULT ''
  amount_usd         integer NOT NULL -- USD cents, post-promo total
  currency           text NOT NULL DEFAULT 'USD'
  status             text NOT NULL DEFAULT 'PENDING' -- PENDING | SUCCESS | FAILED
  promo_code         text
  card_last_4        text
  auto_renew         boolean NOT NULL DEFAULT false
  renewal_for        text             -- subscription row being renewed
  customer_email     text
  whop_payment_id    text             -- pay_… (idempotency for the webhook)
  whop_membership_id text             -- mem_… (recurring matching + admin toggle)
  created_at / updated_at
```

Grant flow: look up intent by reference → if already `SUCCESS`, return silently →
apply entitlement → flip to `SUCCESS` with `UPDATE … SET status='SUCCESS'
WHERE reference=? AND status='PENDING'` as the lock; zero rows affected means
someone else already granted. Recurring charges (no intent) match the live
auto-renewing subscription row by `whop_membership_id` and extend the chain.

---

## 7. The grant logic (one shared helper)

`applySubscriptionPurchase` in `artifacts/api-server/src/video/subscriptions.ts`
is the single grant point: stack a pass from the live ticket expiry, bump the
storage/project quota, `recordSubscription`, increment promo `uses`. Both the
webhook and confirm paths call it. The simulated card checkout
(`POST /subscriptions/purchase`, dev/test only) uses the same helper.

---

## 8. Frontend changes (three surfaces, same swap)

| File | Behavior |
|---|---|
| `artifacts/nexet/src/pages/subscriptions.tsx` (PayModal) | one button → `useCreateWhopCheckout` → `window.location.assign(checkoutUrl)`; on mount detect `?reference=` → call `confirmWhopCheckout` → refetch |
| `artifacts/nexet/src/components/ticket-gate.tsx` | same redirect + confirm for the category pass |
| `artifacts/creators-den/src/components/whop-return.tsx` + profile page | storage buy-more → Whop redirect; return gate confirms and refreshes quota |
| `artifacts/authors-den/src/components/whop-return.tsx` + profile page | project buy-more → Whop redirect; return gate confirms and refreshes quota |

Client work in `lib/api-client-react/src/whop.ts`: `createWhopCheckout({ kind,
planId, promoCode, callbackUrl }) → { checkoutUrl, reference }` and
`confirmWhopCheckout({ reference }) → receipt`. No card digits anywhere.

---

## 9. Recurring billing (Whop-native)

Every catalog plan is mirrored once as a **Whop renewal plan** (30-day billing
period, `renewal_price` = the monthly price). Whop charges the saved card on
its own and fires `payment.succeeded` each cycle; we match the charge to the
live auto-renewing subscription row by `whop_membership_id` and grant the next
row in the chain. The **admin auto-renew toggle** maps to Whop's membership
`cancel_at_period_end` flag (`setMembershipAutoRenew` in `lib/whop.ts`) — off
stops future renewals while keeping access until the current period ends.

---

## 10. Tests

`artifacts/api-server/src/routes/whop.test.ts` covers checkout
(plan mirroring, auto-renew defaults, promo rules, FREE grants), webhooks
(signature + replay rejection, first-purchase grant, recurring grants,
declines, membership deactivation), and confirm (auth/ownership, receipt after
webhook, pending state). The Whop API is stubbed via `vi.stubGlobal("fetch")`
and webhooks are signed with the real Standard-Webhooks algorithm.

---

## 11. Launch checklist

**Dashboard (Whop):**
- [ ] Business activated (KYC) so live payments + payouts work
- [ ] Account API key created (Developer → Account API Keys)
- [ ] One product created (Dashboard → Products) — `WHOP_PRODUCT_ID`
- [ ] Webhook registered (Developer → Webhooks): `/api/whop/webhook`,
      `payment.*` + `membership.*` events, `ws_…` secret saved

**Code:**
- [ ] `WHOP_API_KEY`, `WHOP_ACCOUNT_ID`, `WHOP_PRODUCT_ID`,
      `WHOP_WEBHOOK_SECRET` in `.env`, `.env.example`, `CREDENTIALS.md`,
      `PRODUCTION-ENV.md`
- [ ] `nexet_whop_intents` + `nexet_whop_plans` tables + schema exports
- [ ] `routes/whop.ts` (checkout / webhook / confirm) + mount in
      `routes/index.ts`
- [ ] Raw-body capture in `app.ts` (`express.json({ verify })`)
- [ ] `applySubscriptionPurchase` shared grant helper
- [ ] Frontend: `createWhopCheckout` / `confirmWhopCheckout` hooks + redirect
      swap in the buy surfaces + return gates
- [ ] Tests updated to the Whop flow

**Verify in sandbox** with Whop's test cards before going live, then repeat
the webhook + account checks with live keys.