# Whop Subscriptions — how billing works in Nexet

Status: **implemented and live in `main`** · Gateway: **Whop** (USD only) ·
Migrated from Paystack in PR #205, hardened in PR #206.

This is the reference for everything we built around **Whop subscriptions**:
how a customer pays, how they are granted access, how monthly renewals are
handled, and — in detail — **how a refund or chargeback terminates their
access immediately**, how a *partial* refund is treated, and how access comes
back if we win a dispute.

> Companion docs: `WHOP-PAYMENTS-PLAN.md` (the original design/rollout plan)
> and `.env.example` (the credential setup walkthrough). This file documents
> the system **as built**.

---

## 1. The one-paragraph summary

Buy buttons no longer collect card details. The server mirrors each catalog
plan once as a **Whop renewal plan**, opens a **Whop-hosted checkout**, and the
customer pays on Whop's page — so **no card data ever touches our code** (no PCI
scope). Whop charges the saved card every **30 days** on its own and fires
`payment.succeeded` each cycle. Our server grants the entitlement **exactly
once** from the webhook (or the post-redirect confirm, or a reconciliation
sweep) through one shared helper, `applySubscriptionPurchase`. A **refund or
open dispute revokes that same entitlement immediately** — mid-period, not at
period end — and marks the subscription `REFUNDED`; a **won dispute restores
it**. A **partial refund leaves access alone** for a human to review.

---

## 2. Products and prices (all USD cents)

| Product | `kind` | Plans | Price | Interval |
|---|---|---|---|---|
| NEXET category pass | `pass` | `authors`, `content-creators` | 588¢ ($5.88) | 1 month (30 days) |
| Creator Den storage | `storage` | `g200`, `g500`, `tb1` | 2000¢ / 5000¢ / 6000¢ | 1 month (30 days) |
| Author Den projects | `projects` | `p10`, `p50`, `p200` | 500¢ / 2000¢ / 5000¢ | 1 month (30 days) |

Prices are shared by the Whop checkout and the legacy simulated checkout via
`resolveSubscriptionProduct` in `artifacts/api-server/src/video/subscriptions.ts`,
so a plan prices identically everywhere.

**Cents vs dollars.** Our whole codebase prices in **USD cents** (588). Whop's
API prices in **whole dollars** (`renewal_price: 5.88`). Every boundary call
converts: cents → dollars when we create a plan, dollars → cents when we read a
payment back (`whopPaymentAmountCents`). A rounding cent is tolerated when
comparing refunds against totals.

---

## 3. File map — where everything lives

| Concern | File |
|---|---|
| Whop REST client + webhook signing + payment predicates | `artifacts/api-server/src/lib/whop.ts` |
| `/whop/checkout`, `/whop/webhook`, `/whop/confirm`, grant/refund logic, reconcile sweeps | `artifacts/api-server/src/routes/whop.ts` |
| Grant / revoke / restore entitlement helpers, plan catalog | `artifacts/api-server/src/video/subscriptions.ts` |
| Reconciliation timer | `artifacts/api-server/src/whop/reconcile-runner.ts` |
| Route mounting | `artifacts/api-server/src/routes/index.ts` |
| Raw-body capture + JSON error handler | `artifacts/api-server/src/app.ts` |
| Timer startup | `artifacts/api-server/src/index.ts` |
| Intent table | `lib/db/src/schema/whop-intents.ts` |
| Plan registry | `lib/db/src/schema/whop-plans.ts` |
| Subscriptions + plan settings | `lib/db/src/schema/subscriptions.ts` |
| Paystack → Whop migration (data-preserving) | `lib/db/migrations/0014_whop_payments.sql` |
| Admin auto-renew endpoints | `artifacts/api-server/src/routes/admin.ts` |
| Frontend hooks | `lib/api-client-react/src/whop.ts` |
| Return gates | `artifacts/nexet/src/pages/subscriptions.tsx`, `artifacts/nexet/src/components/ticket-gate.tsx`, `artifacts/creators-den/src/components/whop-return.tsx`, `artifacts/authors-den/src/components/whop-return.tsx` |
| Tests (52) | `artifacts/api-server/src/routes/whop.test.ts` |

---

## 4. Credentials and environment

Four **server-only** values (`whopApiKey()` returns `""` when unset, and the
checkout route answers **503 "Payments are not configured on this server"**):

| Env var | Shape | What it is |
|---|---|---|
| `WHOP_API_KEY` | `whop_…` | Account API key. Sent as `Authorization: Bearer` on every server→Whop call. |
| `WHOP_ACCOUNT_ID` | `biz_…` | The account that owns plans and checkouts. |
| `WHOP_PRODUCT_ID` | `prod_…` | The single product every mirrored plan lives under. |
| `WHOP_WEBHOOK_SECRET` | `ws_…` | Webhook signing secret. **Shown once at creation** in the Whop dashboard. |

Optional operational knob:

| Env var | Default | Meaning |
|---|---|---|
| `WHOP_RECONCILE_INTERVAL_MINUTES` | `5` | How often the reconciliation sweep runs. |

API base is `https://api.whop.com/api/v1`; currency is always `usd`; billing
period is always `30` days (`WHOP_BILLING_PERIOD_DAYS`). Develop against the
Whop **sandbox** keys first — no real money moves.

---

## 5. Data model

### 5.1 `nexet_whop_intents` — one row per checkout session

This is the idempotency anchor. It is written as `PENDING` when a checkout URL
is created, then flipped to `SUCCESS` or `FAILED`.

Key columns:

- `reference` — **primary key**; our own `whp_<uuid>`, minted server-side and
  carried in the Whop checkout metadata, echoed back on the webhook.
- `user_id`, `kind`, `plan_id`, `plan_label`, `interval_label`
- `amount_usd` — USD **cents**, post-promo total. A payment must match this.
- `currency` — always `USD`.
- `status` — `PENDING | SUCCESS | FAILED`.
- `promo_code`, `card_last_4`
- `auto_renew` — whether this checkout signed the customer up for
  Whop-managed renewal.
- `renewal_for` — for a renewal charge, the subscription row being renewed.
- `customer_email`
- `whop_payment_id` (`pay_…`), `whop_membership_id` (`mem_…`)
- `created_at`, `updated_at`

### 5.2 `nexet_whop_plans` — one row per mirrored catalog plan

`(kind, plan_id)` composite PK → `whop_plan_id` (`plan_…`), `amount_usd`,
`billing_period_days`. Cached so we create a Whop plan once per catalog plan.
**Titles are clamped to Whop's 30-character limit** (`clampWhopPlanTitle` in
`lib/whop.ts`): the `"<label> (Monthly)"` title can overflow it — "Content
Creators pass (Monthly)" is 31 — and Whop rejects it with a 400
("Validation failed: Title is too long"), which our checkout surfaced as a 502
and which blocked checkout for that plan entirely. The clamp trims at a word
boundary, so an over-long label degrades to a shorter readable title instead of
failing.
**Repricing invalidates the cache:** if the catalog price no longer matches the
cached `amount_usd`, `getOrCreatePlan` mirrors a **new** Whop plan and
upserts the row (otherwise Whop would bill the old amount while every grant
expects the new one, and both purchases and renewals would be refused).

### 5.3 `nexet_subscriptions` — the record of every purchase

One row per purchased period/charge. Whop-relevant columns:

- `status` — `ACTIVE | CANCELED | EXPIRED | PAST_DUE`, plus **`REFUNDED`**
  (used by the refund path).
- `auto_renew` — the local mirror of Whop's renewal flag.
- `whop_membership_id` (`mem_…`) — how recurring charges match the chain, and
  what the admin toggle flips.
- `whop_plan_id` (`plan_…`), `whop_email`
- `whop_payment_id` (`pay_…`) — makes a payment idempotent: no `pay_…` is ever
  granted twice.
- `renewal_failure` — user-visible reason when a renewal is declined or access
  was revoked (also carries the refund/dispute message).

### 5.4 `nexet_subscription_plan_settings` — admin per-plan auto-renew switch

`(kind, plan_id)` PK → `auto_renew_available`. Only rows that exist override
the code default, which is **on for every plan**.

### 5.5 Migration `0014_whop_payments.sql`

Data-preserving and **idempotent** (every statement is guarded, safe to
re-run). It renames the Paystack tables/columns in place:

- `nexet_paystack_intents` → `nexet_whop_intents`; adds `whop_payment_id`,
  `whop_membership_id`.
- `nexet_paystack_plans` → `nexet_whop_plans`; `plan_code` → `whop_plan_id`;
  adds `billing_period_days`.
- `nexet_subscriptions`: `paystack_subscription_code` → `whop_membership_id`,
  `paystack_plan_code` → `whop_plan_id`, `paystack_email` → `whop_email`,
  `paystack_transaction_reference` → `whop_payment_id`.
- Drops the Paystack-only columns (`paystack_authorization_code`,
  `paystack_customer_code`, `paystack_email_token`) — Whop owns renewal through
  the membership, so we store **no card authorization tokens at all**.

---

## 6. The purchase flow (happy path)

```
[Browser]                 [Our API]                         [Whop]
   │ POST /api/whop/checkout {kind, planId, promoCode?}         │
   │────────────────────────▶│                                  │
   │                         │ resolve product + promo          │
   │                         │ FREE promo → grant, done         │
   │                         │ get-or-create renewal plan       │
   │                         │  (cached in nexet_whop_plans)    │
   │                         │ POST /plans ────────────────────▶│
   │                         │◀──────────── {id, purchase_url}  │
   │                         │ write PENDING intent (whp_…)     │
   │                         │ POST /checkout_configurations    │
   │                         │   {plan_id, redirect_url,        │
   │                         │    metadata:{reference,…}}       │
   │                         │─────────────────────────────────▶│
   │                         │◀──────────── {id, purchase_url}  │
   │◀── 200 {checkoutUrl, reference}                             │
   │ window.location.assign(checkoutUrl)                         │
   │────────────── pays on Whop's hosted page ──────────────────▶│
   │                                                             │
   │ (a) Whop redirects back to redirect_url?reference=whp_…      │
   │     return gate calls POST /api/whop/confirm {reference}     │
   │ (b) Whop POSTs payment.succeeded to /api/whop/webhook        │
   │                         │ verify signature (Standard Webhooks)
   │                         │ grant once, keyed by reference    │
```

### 6.1 `POST /api/whop/checkout` — Clerk auth required

Accepts only `{ kind, planId, promoCode?, callbackUrl? }` — **no card**.

1. Reject if Whop is not configured (503).
2. Validate `kind` (`pass | storage | projects`) and `planId`.
3. Resolve the product; unknown kind/plan → 400.
4. Resolve promo. Only **FREE (100%-off)** promos apply to subscriptions — a
   percentage or dollar-off code is rejected, because a Whop renewal plan
   charges the full monthly amount. A FREE promo grants a free month
   immediately, with **no charge and no membership** (201, `checkoutUrl: null`).
5. Decide auto-renew: `autoRenewAvailableForPlan(kind, planId)` — **on for
   every plan** unless an admin turned it off. Any client-sent `autoRenew` is
   **ignored**.
6. Get-or-create the Whop renewal plan (see §5.2).
7. Block the customer's email from Clerk into the checkout (`primaryEmailAddress`).
8. Mint `reference = whp_<uuid>`, insert a **PENDING** intent, and append
   `?reference=` to the callback URL (`withReference`) so the return gate can
   confirm.
9. `createCheckout(...)` on Whop and return
   `{ granted: false, checkoutUrl, reference }`. The purchase URL gets
   `?email=<addr>&email.hidden=1` (`withKnownEmail`) so Whop pre-fills and
   **hides** its email field.
10. If Whop fails, the intent row is **deleted** (nothing lingers PENDING) and
    a 502 with Whop's own message is returned.

### 6.2 `POST /api/whop/webhook` — no auth, verified by signature

- Reads the **raw body** captured by the `express.json({ verify })` hook in
  `app.ts` and verifies with `whopSignatureValid`.
- Signature algorithm: **HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw body}`**, keyed by `WHOP_WEBHOOK_SECRET`, header is `v1,<base64>`, and the timestamp must be within **5 minutes** (replay guard). Uses `timingSafeEqual`.
- Invalid signature → 401.
- On a handled event it answers `200 { received: true }`; a thrown grant error
  answers **500** so Whop retries.

### 6.3 `POST /api/whop/confirm` — Clerk auth required

Called by the return page with `?reference=`. Auth + ownership enforced
(403 if the intent belongs to someone else, 404 if unknown).

- `SUCCESS` → `{ granted: true, receipt: { total, cardLast4, promoCode } }`
- `FAILED` → `{ granted: false, status: "failed" }`
- `PENDING` → **verifies against Whop directly** via `verifyIntentWithWhop`
  (see §9) rather than trusting a single webhook delivery. Outcomes:
  - `granted` → returns the receipt
  - `failed` / `mismatch` → `{ granted: false, status: "failed" }`
  - `pending` → `{ granted: false, status: "pending" }` ("still being confirmed")

---

## 7. Granting access — the single idempotent path

Both the webhook and confirm funnel into `applySubscriptionPurchase` in
`video/subscriptions.ts`, the same helper the legacy simulated checkout uses.
What it does per kind:

- **`pass`** → inserts a ticket row into `nexet_tickets` whose `expires_at` is
  the new period end. **Renewing while a pass is still live extends from the
  current expiry** rather than from now.
- **`storage`** → adds the plan's bytes to `nexet_account_quotas.storage_limit_bytes`.
- **`projects`** → adds the plan's project count to `nexet_account_quotas.project_limit`.
- Applies promo bookkeeping (`uses++`, one redemption per user).
- Writes the `nexet_subscriptions` row (status `ACTIVE`) carrying the Whop ids.
- If this was a renewal, the row it renewed stops being the live auto-renew
  record (`autoRenew: false`) so there is exactly one live row per chain.

### 7.1 Idempotency, precisely

| Path | Guard |
|---|---|
| First purchase (intent) | Atomic claim `UPDATE … SET status='SUCCESS' WHERE reference=? AND status='PENDING'` — zero rows affected ⇒ someone already granted. |
| Any charge | `nexet_subscriptions.whop_payment_id` — a `pay_…` already recorded is never granted again. |
| Amount/currency | Payment must equal `intent.amount_usd` and currency must match, otherwise the intent is marked `FAILED` and the grant is refused (see §8.3). |
| Grant throws | The intent is **reset to PENDING** so a webhook retry or the sweep can complete it. |

---

## 8. Recurring billing (Whop-native renewals)

Every catalog plan is mirrored once as a Whop **renewal** plan (`plan_type:
"renewal"`, `initial_price: 0`, `renewal_price: monthly`, `billing_period: 30`).
Whop charges the saved card on its own and fires `payment.succeeded` each cycle.
A recurring charge has **no intent reference**, so `grantSubscriptionCharge`
matches it to the live row by `whop_membership_id` and grants the next row in
the chain.

**Important:** a recurring charge is matched on the **membership alone**, not on
our `auto_renew` flag. Whop already took the money; refusing to grant because a
local flag drifted would charge the customer and hand them nothing. A drifted
flag is logged loudly and the purchase is granted anyway. The charge amount
must still match the plan's current monthly price.

### 8.1 Webhook events we handle

| Event | Action |
|---|---|
| `payment.succeeded` | Grant once (§7). Recurring if no reference → membership path. |
| `payment.failed` | With a reference: mark the PENDING intent `FAILED`. Renewal: set `renewal_failure` on the live auto-renew row. |
| `membership.deactivated` | Set `auto_renew = false` on rows with that membership (cancelled/completed). Access is *not* cut — it simply stops renewing. |
| `membership.cancel_at_period_end_changed` | Mirror Whop: `auto_renew = !cancel_at_period_end`. Whop is the source of truth (the customer can cancel on Whop's own billing page too). |
| `refund.created` / `refund.updated` / `dispute.created` / `dispute.updated` | Re-read the payment and act — §10. |

### 8.2 Admin auto-renew toggle

`PATCH /api/admin/subscriptions/:id/auto-renew` (`requireAdmin`) maps to Whop's
membership `cancel_at_period_end` flag via `setMembershipAutoRenew`:

- Turning **off** first stops Whop from charging (`cancel_at_period_end: true`),
  then sets the local flag — so the customer stops being billed. Access is kept
  until the current period ends.
- Turning **on** resumes the same membership (`cancel_at_period_end: false`).
  If the row has no `whop_membership_id`, it is rejected (400).
- A Whop failure returns 502 and the local flag is **not** flipped.

An admin can also disable auto-renew for a whole plan via
`/api/admin/plan-settings/:kind/:planId` (`auto_renew_available`).

---

## 9. Reconciliation — the safety net for a missed webhook

A webhook is a single delivery. If it is lost (deploy, downtime, rotated
secret, exhausted retries) and nothing else noticed, **a paying customer would
never receive their plan**. Two sweeps run in the API process
(`startWhopReconciliation`, first run ~20s after boot, then every
`WHOP_RECONCILE_INTERVAL_MINUTES`, default 5):

1. **`reconcileWhopIntents()`** — takes up to 50 `PENDING` intents. Skips ones
   younger than **2 minutes** (give the webhook a chance), then asks Whop for
   the matching payment (`findPaymentByReference`, scanning payments created
   around the intent). Grants if paid; marks `FAILED` if Whop clearly killed
   the charge (`void`, `uncollectible`, `unresolved`); marks `FAILED` after
   **24 hours** if still unpaid (an abandoned checkout).
2. **`reconcileRecentPayments()`** — lists every payment from the last
   **24 hours** and runs each `succeeded` one through `handlePaymentSucceeded`.
   Recovered charges are logged at **error** level ("investigate why it was
   missed"); settled payments matching no intent/subscription are logged as a
   **dead-letter** line for manual review.

`verifyIntentWithWhop` never throws: a Whop outage leaves the intent `PENDING`
so the webhook or a later sweep can still complete it.

---

## 10. Refunds, disputes, and terminating access

This is the heart of the "harden Whop payments" work.

### 10.1 Principle: the event is a trigger, Whop's record is the evidence

A reversal is **not necessarily one-way** and **not always a full reversal**:

- a dispute can be **won** (no money leaves → access should return),
- a **partial** refund is not a reversal of the purchase at all (the customer
  kept what they paid for).

So the webhook handler does not act on the event payload alone. It re-reads the
payment from Whop (`fetchPaymentById`) and lets the **live payment record**
decide. The only fallback where the event decides is when Whop cannot be
re-read (see §10.5).

### 10.2 Decision table (`refreshSubscriptionForPayment`)

Given the subscription row holding `whop_payment_id == <the event's payment>`:

| Whop payment record | Outcome |
|---|---|
| No subscription holds this payment id | **Error log — manual review** (can't safely revoke an unknown purchase). |
| Open dispute **or** fully refunded | **Revoke access now** → row `REFUNDED`, `auto_renew` off. |
| Refunded but **not fully** (partial) | **Left `ACTIVE`**, logged at error level for manual review. |
| Settled & clear **and** row is `REFUNDED` | **Restore access** → row back to `ACTIVE`. |
| Settled & clear and row is not `REFUNDED` | Nothing to do. |
| Whop unreachable + event ends `.created` | **Revoke** (safe direction for a reversal we can't verify). |
| Whop unreachable + event ends `.updated` | **Do nothing** — never reinstate access blindly. |

- **Fully refunded** (`whopPaymentFullyRefunded`): `refunded_amount >= total − $0.01`; if no amount is reported but `refunded_at` is set, it assumes the whole charge went back. Whop reports whole dollars.
- **Open dispute** (`whopPaymentHasOpenDispute`): any dispute whose status is in
  `{ needs_response, warning_needs_response, under_review, warning_under_review }`.
  Decided statuses (e.g. `won`) are terminal — that's what lets a won dispute
  restore access.
- Observed dispute statuses are logged so the open-status set can be extended if
  Whop introduces a new in-flight state.

### 10.3 Revoking access (`revokeAccessForRefund`) — atomic and double-safe

```ts
const change = await db.transaction(async (tx) => {
  const [claimed] = await tx
    .update(nexetSubscriptionsTable)
    .set({ status: "REFUNDED", autoRenew: false,
           renewalFailure: "This purchase was refunded — the plan is no longer active." })
    .where(and(eq(id, row.id), ne(status, "REFUNDED")))   // ← atomic claim
    .returning({ id });
  if (!claimed) return null;                               // already refunded
  return revokeSubscriptionEntitlement(entitlementRefFor(row), tx);
});
```

- The **`status <> 'REFUNDED'` claim** means a redelivered or concurrent webhook
  cannot take the same credits back twice.
- Row update + revocation happen in **one transaction**: access can never be cut
  without the record saying so, or the record say so while access still stands.
- If the revocation throws, the rollback leaves the row `ACTIVE` and the route
  returns 500, so **Whop's retry runs the whole thing again cleanly**.
- Message differs for a dispute ("A payment dispute was opened…") vs a refund
  ("This purchase was refunded…").

### 10.4 What exactly gets taken away, per product

`revokeSubscriptionEntitlement` removes the **same entitlement the grant
created**:

| Kind | What is removed | Safeguard |
|---|---|---|
| `pass` | The ticket row in `nexet_tickets`. | Matched by the **exact `expires_at`** the grant stamped on it (`= row.periodEnd`), so a second, separately-paid pass is never collateral damage. If no exact match: only cuts when there is **exactly one live pass** for the category (with a warning); **2+ live passes → warning "cut one manually", nothing is deleted**. |
| `storage` | The plan's bytes from `storage_limit_bytes`. | **Floored at the free tier** — a refund can never push an account below `DEFAULT_STORAGE_LIMIT_BYTES`. |
| `projects` | The plan's project count from `project_limit`. | **Floored at `DEFAULT_PROJECT_LIMIT`** (the free tier). |

Revocation is safe to run twice (deleting an already-gone ticket is a no-op,
and subtracting credits already floored yields zero). Every change is logged
with `ticketRemoved` / `storageBytesRemoved` / `projectSlotsRemoved`.

**Net effect:** the moment Whop reports a full refund or an open dispute, the
customer's pass disappears / their quota drops back — **immediately**, mid-period,
not at the paid period's end.

### 10.5 Restoring access when we win (or the reversal is undone)

If the payment is later settled and clear and the row is `REFUNDED` (e.g. a
dispute we **won**), `refreshSubscriptionForPayment` restores:

```ts
const [claimed] = await tx
  .update(nexetSubscriptionsTable)
  .set({ status: "ACTIVE", renewalFailure: null })
  .where(and(eq(id, row.id), eq(status, "REFUNDED")))     // ← atomic claim
  .returning({ id });
if (!claimed) return null;                                 // a concurrent event won
return restoreSubscriptionEntitlement(entitlementRefFor(row), tx);
```

- **Idempotent**: `restoreSubscriptionEntitlement` will not re-create a ticket
  that already exists, and only runs from the `REFUNDED → ACTIVE` claim, so a
  repeated `.updated` event cannot duplicate credits.
- A pass is only restored if its `periodEnd` is **still in the future** —
  there'd be no access to restore if the period already lapsed.
- **Auto-renew is deliberately left off**: access is restored, billing is not.

### 10.6 Cases that are escalated to a human (by design)

These are logged at **error** level and require someone to look at the Whop
dashboard; the code deliberately does **not** auto-refund, auto-grant, or
blind-cut:

- **Amount/currency mismatch** on a first purchase — the intent is marked
  `FAILED`, and the log says the customer *may have been charged*.
- **Partial refund** — the plan stays active.
- **Refund/dispute event with no payment id** in the payload.
- **Refund/dispute for a payment no subscription holds**.
- **Recurring charge whose amount mismatches** the plan price.
- **Reconciled payment matching no intent or subscription** (dead-letter).

### 10.7 Refund flow, end to end

```
Whop: refund issued / chargeback opened
        │  webhook: refund.created | refund.updated | dispute.created | dispute.updated
        ▼
POST /api/whop/webhook  (signature verified)
        │  paymentIdFromEvent(data)  ← data.payment_id OR data.payment.id
        ▼
refreshSubscriptionForPayment(paymentId, eventType)
        │  find subscription WHERE whop_payment_id = paymentId
        │  (none → error log, manual review, return)
        ▼
    fetchPaymentById(paymentId)   ── unreachable? ──┐
        │                                          │ .created → revoke
        ▼                                          │ .updated → do nothing
  ┌───────────────────────────────────────────────┴──────────────┐
  │ open dispute  OR fully refunded → revokeAccessForRefund()      │
  │        transaction: status→REFUNDED (atomic claim) +           │
  │                     revokeSubscriptionEntitlement()            │
  │ partial refund  → stay ACTIVE, error log, manual review        │
  │ settled+clear & row REFUNDED → status→ACTIVE + restore         │
  └────────────────────────────────────────────────────────────────┘
        │
        ▼  (later) customer's next renewal: membership may be gone;
           no charge, access already revoked.
```

---

## 11. Frontend integration

Hooks in `lib/api-client-react/src/whop.ts`:

- `useCreateWhopCheckout()` → `POST /api/whop/checkout` → for a paid plan,
  `window.location.assign(checkoutUrl)`; for a FREE promo, `granted: true`.
- `useConfirmWhopCheckout()` → `POST /api/whop/confirm { reference }`.

**Payment loading animation.** The moment a pay button is clicked, a full-screen
`PaymentLoadingOverlay` (`artifacts/nexet/src/components/payment-loading.tsx`,
`artifacts/authors-den/src/components/payment-loading.tsx`,
`artifacts/creators-den/src/components/payment-loading.tsx`) covers the page with
an animated "Opening secure checkout…" state — a spinning ring around a card
icon, a sweeping progress bar, and a "Secured by Whop" chip. It is driven by the
same `isPending || opening` flag as the button, so it appears while the server
creates the checkout session and stays up through the 350 ms hand-off before
`window.location.assign(checkoutUrl)`. The pay button keeps its own inline
spinner underneath. The overlay sits above the pay modal (`z-index` 70 in NEXET,
60 in Author Den) so an unfinished purchase cannot be re-triggered, and it
freezes (no motion) under `prefers-reduced-motion`.

Creator Den's "Buy more space" raises the same overlay too. It is a link to the
NEXET Subscriptions desk (`/subscriptions?focus=storage`) rather than an inline
checkout, so the CTA shows the overlay, lets it paint, then navigates after a
short delay; the actual checkout then runs in that page's PayModal (which shows
the overlay again while the Whop session is created).

Return gates (all read `?reference=` on mount, confirm, then refresh the
relevant queries):

- `artifacts/nexet/src/pages/subscriptions.tsx` (PayModal)
- `artifacts/nexet/src/components/ticket-gate.tsx` (category pass)
- `artifacts/creators-den/src/components/whop-return.tsx` (storage)
- `artifacts/authors-den/src/components/whop-return.tsx` (projects)

**Success animation.** When a gate confirms a charge it plays a brief
`SuccessCheck` — an SVG circle and check that draw themselves in once (~0.8s)
with a single ring burst, then hold (styles: `success-check*` in each app's
stylesheet; component: `components/success-check.tsx` in NEXET, Author Den, and
Creator Den). It is decorative (`aria-hidden`) because the adjacent "Payment
confirmed" text already announces the result, and under
`prefers-reduced-motion` it renders statically with no drawing or burst. The
NEXET pass purchase shows its own stamped-pass reveal instead.

**Dismissing.** Every payment card closes on a click outside it (the backdrop
handles the click; the card stops propagation so an inside click never
closes it), and the result/receipt cards close the same way. The exception is
while a payment is actually in flight — the pay modal is not dismissible during
`isPending || opening` so a stray click cannot cancel the hand-off. The NEXET
pass coupon is a paywall, so dismissing it swaps it for an "Unlock …" button
rather than leaving a dimmed room with no way back.

The confirm call is idempotent, so a page refresh or double-fire is harmless;
the gate also strips the query params afterwards.

---

## 12. Error handling note

`app.ts` installs a JSON error handler after the routes. Before this, an
unhandled throw returned Express's HTML `<pre>Bad Request</pre>` (and hid the
message in production) — which is exactly how a `WhopApiError` from
`/whop/checkout` became an unreadable dead end. Now: 4xx errors pass their
message through; anything else is reported as 500 with the message withheld in
production, and the underlying error is always logged.

---

## 13. Tests

`artifacts/api-server/src/routes/whop.test.ts` — **52 tests**, all passing.
Whop's API is stubbed via `vi.stubGlobal("fetch")` and webhooks are signed with
the **real** Standard-Webhooks algorithm. Coverage includes:

- Checkout: plan mirroring + cache reuse + repricing, auto-renew defaults,
  promo rules (FREE grants, % rejected), unknown products, config 503.
- Webhooks: signature + replay rejection, first-purchase grant, membership
  capture, recurring grants granted exactly once, declines,
  `membership.deactivated`, `cancel_at_period_end_changed`, and
  "grants a renewal even when our auto-renew flag drifted".
- Confirm: auth/ownership, receipt after webhook, pending state.
- **Refunds** (`describe("refunds cut access immediately")`): pass ticket
  removed, storage/project quota reduced (floored), partial refund stays
  `ACTIVE`, dispute opened revokes, dispute won restores, amount/currency
  mismatch refused, reconcile intent + payment sweeps.

Run locally:

```bash
cd artifacts/api-server && npx vitest run src/routes/whop.test.ts
# full workspace checks
pnpm run typecheck
```

---

## 14. Operations runbook

**Set up** (Whop dashboard): business activated (KYC) → Account API key →
one product (`WHOP_PRODUCT_ID`) → webhook at
`https://<api-host>/api/whop/webhook` subscribed to `payment.*`,
`membership.*`, `refund.*`, `dispute.*` → save the `ws_…` secret. Put all four
env vars in the deploy (Render) — the app returns 503 for checkout without them.

**Common log lines to watch** (all at error level = needs a human):

| Log | Meaning | Action |
|---|---|---|
| `whop checkout: failed to create the mirror plan` | Whop rejected `POST /plans` (e.g. a title over 30 chars, or a bad `WHOP_PRODUCT_ID`/account pairing). The customer sees it as a 502. | Check the label length and the product/account env values. |
| `whop amount/currency mismatch — intent marked FAILED` | Money may have moved but grant refused. | Check the Whop dashboard; refund or grant manually. |
| `whop refund: partial refund — subscription left active` | Customer kept access. | Decide policy with finance. |
| `whop refund/dispute: no subscription holds this payment id` | Orphan reversal. | Find and handle the purchase manually. |
| `whop reconcile: recovered a settled payment that was never recorded` | A webhook was missed. | Investigate delivery (secret, URL, retries). |
| `whop reconcile: settled payment(s) matched no intent or subscription` | Dead letter. | Reconcile manually. |
| `whop recurring charge on a subscription we believed was not auto-renewing — granting anyway` | Local flag drifted. | Worth checking why the flag drifted. |

**Invariants to preserve when changing this code:**

1. Every grant goes through `applySubscriptionPurchase` — keep it the single
   grant point.
2. Never grant twice: keep the intent claim and the `whop_payment_id` check.
3. A reversal must revoke **in the same transaction** as the `REFUNDED` claim.
4. Never blind-cut: match the pass ticket by exact expiry, and escalate when
   ambiguous.
5. Never let a refund push usage below the free tier.
6. Whop's payment record — not the webhook payload — decides refund outcomes.
7. The webhook must remain idempotent and return 500 on a failed grant so Whop
   retries.
