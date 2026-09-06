# Paystack (USD) — Subscription Payment Integration Plan

Status: **planning** · Gateway: **Paystack** · Currency: **USD only**

Reference doc for replacing the app's simulated card checkout with real Paystack
payments. Today no money actually moves: the browser collects card
number/expiry/CVC and the API server validates it with a Luhn check, then grants
the entitlement. With Paystack hosted checkout the customer pays on Paystack's
page and **no card data ever touches our code** (removes PCI scope).

Products being paid for (all prices in **USD cents** — identical to Paystack's
USD amount unit, so there is zero conversion):

| Product | Plans | Current price |
|---|---|---|
| TANDEM category passes (`pass`) | `authors`, `content-creators` | 188¢ ($1.88) / 3 weeks |
| Creator Den storage (`storage`) | `g200`, `g500`, `tb1` | 2000¢ / 5000¢ / 6000¢ |
| Author Den projects (`projects`) | `p10`, `p50`, `p200` | 500¢ / 2000¢ / 5000¢ |

---

## 1. Credentials — what to get from Paystack

Everything lives in **Paystack Dashboard → Settings → API Keys & Webhooks**
(two sections: *API Configuration – Test Mode* and *API Configuration – Live
Mode*).

| Env var | Value | Notes |
|---|---|---|
| `PAYSTACK_SECRET_KEY` | `sk_test_…` (dev) / `sk_live_…` (prod) | **The only credential required.** Sent as `Authorization: Bearer sk_…` on every server→Paystack API call. Server-only — never in any frontend `.env`. |
| `PAYSTACK_PUBLIC_KEY` | `pk_test_…` / `pk_live_…` | **Not needed** for hosted checkout (only for the Paystack Inline popup flow). Optional. |

- **No separate webhook secret.** Paystack signs every webhook with HMAC-SHA512
  **using your secret key** (`x-paystack-signature` header). One key, two jobs.
- Keys live in the repo-root `.env` (api-server loads `.env` on boot via
  `artifacts/api-server/src/env.ts`). Add `PAYSTACK_SECRET_KEY` to
  `.env.example` and `CREDENTIALS.md`.

### USD-specific requirements (Nigeria-based business)

Paystack **does** support USD, but the dashboard needs two things first:

1. **International payments enabled** — Settings → **Preferences** → the
   *"Accept international payments"* box ticked. Requires business **activated**
   (KYC/compliance). If missing, click *Request international payments*
   (~48 working hours approval).
2. **USD settlement account** — Settings → **Accounts** → *"Add USD account"*:
   a **Zenith Bank USD domiciliary account** (Paystack's Nigeria partner bank;
   Kenya businesses use a local USD account). Review ~24h; this confirms *USD
   enabled as a currency*. No $1,000 minimum deposit is required despite what
   some bank branches claim.

Notes:
- Fees: USD via Visa/Mastercard/Verve = **3.9% flat** (the ₦100 fixed fee
  applies only to NGN charges). Decide margin handling before launch.
- Settlement is in USD. Only card payments (Visa/Mastercard/Verve; Amex with
  international payments) — no USD bank transfer.
- Test mode needs no setup: toggle Test Mode, use test card `4084 0840 8408 4081`.

---

## 2. URLs to add on the Paystack dashboard

| URL | Where | Value |
|---|---|---|
| **Webhook URL** (required) | Settings → API Keys & Webhooks (set for **Test and Live separately**) | `https://<your-api-host>/api/paystack/webhook` |
| **Callback URL** (optional, global fallback) | Same page | Any value — better practice: pass a **per-purchase** `callback_url` at `transaction.initialize`, overriding this global one, so each app redirects back to itself |

---

## 3. Overall flow

```
[Browser]                    [Your API server]                    [Paystack]
    │ POST /api/paystack/checkout {kind, planId, promoCode}            │
    │──────────────────────────────▶│                                  │
    │                               │ resolve price+promo, mint        │
    │                               │ reference, save intent PENDING   │
    │                               │ transaction.initialize           │
    │                               │  {email, amount, currency:"USD", │
    │                               │   reference, callback_url, meta} │
    │                               │──────────────────────────────────▶│
    │                               │◀──── {authorization_url, ref}    │
    │◀────── 200 {authorizationUrl} │                                  │
    │ redirect (window.location)    │                                  │
    │──────────────────────────────────────────────────────────────────▶│
    │                           customer pays on Paystack page         │
    │ (a) redirect back ──── callback_url?paystack_ref=… ──▶ browser   │
    │     page calls POST /api/paystack/confirm                        │
    │ (b) webhook ────── charge.success ──▶ POST /api/paystack/webhook │
    │                               │──────────────────────────────────▶│
    │                               │ verify (signature / verify API)  │
    │                               │ grant entitlement (once, by ref) │
```

Two paths converge on one idempotent **grant-by-reference** function:

- **Webhook** (`charge.success`, always fired by Paystack) = source of truth;
  covers users who close the tab mid-payment.
- **Confirm** (triggered by the callback redirect) = instant UI feedback via
  Paystack's `verify` API. May race the webhook — grant must be idempotent.

---

## 4. New/changed API endpoints

### 4.1 `POST /api/paystack/checkout` — new (Clerk auth required)

File: `artifacts/api-server/src/routes/paystack.ts`, mounted in
`artifacts/api-server/src/routes/index.ts`. Accepts **no card** — only
`{ kind, planId, promoCode? }`.

Steps:
1. Resolve product + price + promo (reuse `subscriptionPlans`, `planPrice`,
   `resolvePromo`, `PASS_PRICE_USD` — the math that exists today).
2. Mint a server-side reference: `tan_${randomUUID()}`.
3. Save a **PENDING intent** row (see §6).
4. Call Paystack initialize:

```ts
// node 18+ fetch — no SDK needed (matches the codebase style)
const res = await fetch("https://api.paystack.co/transaction/initialize", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, // sk_test_… / sk_live_…
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,              // from Clerk: clerkClient.users.getUser(userId).primaryEmailAddress
    amount: totalUsdCents,   // $1.88 → 188, $20 → 2000  ← already the priceUsd unit
    currency: "USD",
    reference,          // you mint it; never accept a client-supplied reference
    callback_url: `${TANDEM_WEB_URL}/subscriptions?paystack_ref=${reference}`,
    metadata: { userId, kind, planId, promoCode },
  }),
});
// response: { status: true, data: { authorization_url, reference, access_code } }
```

5. Respond `{ authorizationUrl, reference }`.

### 4.2 `POST /api/paystack/webhook` — new (no auth, raw JSON body)

- Verify HMAC-SHA512 signature against `x-paystack-signature` (see §5 — this
  needs a raw-body capture in `app.ts`).
- On `event.event === "charge.success"` → `grantByReference(event.data.reference)`.
- Always answer fast with `200 { received: true }`.

### 4.3 `POST /api/paystack/confirm` — new (Clerk auth required)

Called by the frontend return page when it sees `paystack_ref` on mount.

```ts
const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
});
const data = (await res.json()).data; // { status, amount, currency, authorization: { last4 }, metadata }
```

**Grant only when all three hold:**
1. `data.status === "success"`
2. `data.currency === "USD"`
3. `data.amount ===` the cents stored on the intent row (never trust the client)

Then grant and return today's receipt shape (`cardLast4` from
`data.authorization.last4`). Only the user who owns the reference may confirm it
(map `reference → userId` via the intent row).

---

## 5. Webhook signature verification (raw body)

`app.ts` runs `express.json()` globally **before** routes, which consumes the
body — but HMAC-SHA512 is computed over the raw bytes. Capture the buffer during
parsing:

```ts
// artifacts/api-server/src/app.ts
app.use(express.json({ verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } }));
```

Then in the webhook route:

```ts
const raw = String(req.rawBody ?? "");
const sig = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY!).update(raw).digest("hex");
const theirs = req.headers["x-paystack-signature"];
if (!theirs || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(String(theirs)))) {
  res.status(401).json({ error: "Invalid signature" }); // secret key IS the webhook secret
  return;
}
const event = req.body; // { event: "charge.success", data: { reference, amount, currency, … } }
if (event.event === "charge.success") await grantByReference(event.data.reference);
res.status(200).json({ received: true });
```

---

## 6. Idempotency — new `tandem_paystack_intents` table

Webhooks can arrive twice, and the confirm path races the webhook. Add a small
table `lib/db/src/schema/paystack-intents.ts`, exported from
`schema/index.ts` like the other tables:

```
tandem_paystack_intents:
  reference   text      PRIMARY KEY   -- tan_<uuid>, minted server-side
  user_id     text      NOT NULL
  kind        text      NOT NULL      -- pass | storage | projects
  plan_id     text      NOT NULL
  plan_label  text      NOT NULL
  amount_usd  integer   NOT NULL      -- USD cents, post-promo total
  currency    text      DEFAULT 'USD'
  promo_code  text
  status      text      DEFAULT 'PENDING'   -- PENDING | SUCCESS | FAILED
  created_at  timestamp with time zone  DEFAULT now()
  updated_at  timestamp with time zone  DEFAULT now()
```

Grant flow: look up intent by reference → if already `SUCCESS`, return silently →
apply entitlement → flip to `SUCCESS`. Use `UPDATE … SET status='SUCCESS'
WHERE reference=? AND status='PENDING'` as the lock; zero rows affected means
someone else already granted.

---

## 7. Consolidate the grant logic (three copies exist today)

Today "apply purchase" is duplicated in:
- `artifacts/api-server/src/routes/tickets.ts` — pass: insert ticket, stack
  expiry from the live pass, `recordSubscription`.
- `artifacts/api-server/src/routes/subscriptions.ts` — pass OR quota bump +
  `recordSubscription`.
- `artifacts/api-server/src/routes/account.ts` — storage/project quota bump
  (grants with **no payment at all**).

Extract **one** helper — e.g. `applyPaidEntitlement({ userId, kind, planId,
totalUsd, promoCode, cardLast4 })` in
`artifacts/api-server/src/video/subscriptions.ts` — that reproduces exactly what
those handlers do (stack from live ticket expiry, bump quota,
`recordSubscription`, increment promo `uses`). Both the webhook and confirm
paths call it. Old endpoints become internal callers or are removed once the
frontends migrate.

---

## 8. Frontend changes (three surfaces, same swap)

| File | Today | After |
|---|---|---|
| `artifacts/tandem/src/pages/subscriptions.tsx` (PayModal) | card number/expiry/CVC inputs → `usePurchaseSubscription` | one button → `useCreateCheckout` → `window.location.assign(authorizationUrl)`; on mount detect `paystack_ref` → call confirm → refetch |
| `artifacts/creators-den/src/components/account-panel.tsx` | card form → purchase hook | same redirect, callback back to the den page |
| `artifacts/authors-den/src/components/profile-page.tsx` | card form → purchase hook | same redirect |

Client work in `lib/api-client-react/src/subscriptions.ts`: replace
`purchaseSubscription` (which sends a card) with
`createPaystackCheckout({ kind, planId, promoCode }) → { authorizationUrl }` and
`confirmPaystackCheckout(reference) → receipt`. Keep the receipt UI; it just
stops asking for card digits first. Accept that checkout is a real redirect away
from the app and back (modal flow becomes redirect-and-return).

---

## 9. Recurring billing

Keep **every purchase a one-time USD charge**, user-initiated (matches the
current repurchase model). Paystack's auto-charging `Plan`/`Subscription`
objects don't fit cleanly (pass = 3-week rolling; storage "recurring" but
implemented as a +1-yr quota extension; projects one-time) and auto-renew needs
saved card authorization + retry handling. Paystack Plans can come later if true
auto-renewal is wanted.

---

## 10. Tests to update

`artifacts/api-server/src/routes/subscriptions.test.ts`, `tickets.test.ts`, and
`account.test.ts` assert the current immediate-grant behavior and will need
rewriting to the intent → webhook/confirm shape with the Paystack client mocked
(initialize returns a fake `authorization_url`; webhook event drives the grant).

---

## 11. Launch checklist

**Dashboard (Paystack):**
- [ ] Business activated (KYC/compliance)
- [ ] *Accept international payments* enabled (Settings → Preferences)
- [ ] Zenith Bank USD domiciliary account added (Settings → Accounts → *Add USD account*)
- [ ] Webhook URL set for **Test** then **Live**: `https://<api-host>/api/paystack/webhook`

**Code:**
- [ ] `PAYSTACK_SECRET_KEY` in `.env`, `.env.example`, `CREDENTIALS.md`
- [ ] `tandem_paystack_intents` table + schema export
- [ ] `routes/paystack.ts` (checkout / webhook / confirm) + mount in `routes/index.ts`
- [ ] Raw-body capture in `app.ts` (`express.json({ verify })`)
- [ ] `applyPaidEntitlement` shared grant helper in `video/subscriptions.ts`
- [ ] Frontend: `createPaystackCheckout` / `confirmPaystackCheckout` hooks +
      redirect swap in the three buy surfaces
- [ ] Tests updated to the two-step flow

**Verify in test mode** with Paystack test card `4084 0840 8408 4081` before
going live, then repeat the webhook + account checks with live keys.
