import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Whop — thin client for the Whop REST API (hosted checkout, USD). Every
// request authenticates with the server-only Account API key (WHOP_API_KEY)
// as `Authorization: Bearer whop_…`. Webhook events are verified with the
// Standard Webhooks spec: HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw
// body}` keyed by the separate webhook secret (WHOP_WEBHOOK_SECRET, ws_…).
// ---------------------------------------------------------------------------

export const WHOP_API_BASE = "https://api.whop.com/api/v1";
// The account settles in USD; Whop prices are whole dollars (5.88 = $5.88),
// while the app prices subscriptions in USD cents (588). Every boundary call
// converts: cents → dollars outbound, dollars → cents inbound.
export const WHOP_CURRENCY = "usd" as const;
// Every catalog plan bills monthly — 30 days between Whop renewal charges.
export const WHOP_BILLING_PERIOD_DAYS = 30;

/** Server-only Account API key from the developer dashboard (whop_…). */
export function whopApiKey(): string {
  return process.env.WHOP_API_KEY ?? "";
}

/** The account (biz_…) that owns the plans and checkouts. */
export function whopAccountId(): string {
  return process.env.WHOP_ACCOUNT_ID ?? "";
}

/** The product (prod_…) the mirrored plans belong to. */
export function whopProductId(): string {
  return process.env.WHOP_PRODUCT_ID ?? "";
}

/** Webhook signing secret (ws_…), shown once at webhook creation. */
export function whopWebhookSecret(): string {
  return process.env.WHOP_WEBHOOK_SECRET ?? "";
}

export class WhopApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface WhopErrorBody {
  error?: { message?: string; type?: string };
  message?: string;
}

async function whopRequest<T = unknown>(
  path: string,
  init: { method: "GET" | "POST" | "PATCH"; body?: string },
): Promise<T> {
  const key = whopApiKey();
  if (!key) {
    throw new WhopApiError(503, "Payments are not configured on this server (WHOP_API_KEY is missing)");
  }
  let res: Response;
  try {
    res = await fetch(`${WHOP_API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body,
    });
  } catch (cause) {
    throw new WhopApiError(502, `Whop is unreachable (${init.method} ${path})`);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }

  if (!res.ok || json === null) {
    const body = json as WhopErrorBody | null;
    const message =
      body?.error?.message ?? body?.message ?? `Whop ${init.method} ${path} failed (HTTP ${res.status})`;
    throw new WhopApiError(res.status, message);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Plans — mirror a catalog plan as a Whop renewal plan (one per kind+planId,
// cached in nexet_whop_plans). Whop charges the renewal price every
// billing_period days on its own and fires payment.succeeded each cycle.
// ---------------------------------------------------------------------------

export interface CreatePlanInput {
  title: string;
  /** Monthly price in USD cents (e.g. 588 for $5.88/mo). */
  amountCents: number;
  /** Days between renewal charges — always 30 (monthly) here. */
  billingPeriodDays?: number;
}

export interface CreatePlanResult {
  /** Whop plan id (plan_…). */
  whopPlanId: string;
  /** The Whop-hosted checkout URL for this plan. */
  purchaseUrl: string;
}

// Whop rejects a plan title longer than this ("Validation failed: Title is too
// long (maximum is 30 characters)"). Our catalog labels plus a suffix sail
// close to it — "Content Creators pass (Monthly)" is 31 — so every title is
// clamped at the boundary rather than trusted to fit.
export const WHOP_PLAN_TITLE_MAX = 30;

/**
 * Clamp a plan title to Whop's limit without splitting a word, so a long
 * catalog label degrades to a shorter readable title instead of failing the
 * checkout outright. "Content Creators pass (Monthly)" → "Content Creators pass".
 */
export function clampWhopPlanTitle(title: string): string {
  const clean = title.trim();
  if (clean.length <= WHOP_PLAN_TITLE_MAX) return clean;
  const cut = clean.slice(0, WHOP_PLAN_TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/** POST /plans — create a renewal plan under WHOP_PRODUCT_ID. */
export async function createPlan(input: CreatePlanInput): Promise<CreatePlanResult> {
  const accountId = whopAccountId();
  if (!accountId) {
    throw new WhopApiError(503, "Whop payments are not configured (WHOP_ACCOUNT_ID is missing)");
  }
  const productId = whopProductId();
  if (!productId) {
    throw new WhopApiError(503, "Whop payments are not configured (WHOP_PRODUCT_ID is missing)");
  }
  const json = await whopRequest<{ id: string; purchase_url: string }>("/plans", {
    method: "POST",
    body: JSON.stringify({
      account_id: accountId,
      product_id: productId,
      title: clampWhopPlanTitle(input.title),
      plan_type: "renewal",
      initial_price: 0,
      renewal_price: input.amountCents / 100,
      billing_period: input.billingPeriodDays ?? WHOP_BILLING_PERIOD_DAYS,
      currency: WHOP_CURRENCY,
    }),
  });
  return { whopPlanId: json.id, purchaseUrl: json.purchase_url };
}

// ---------------------------------------------------------------------------
// Checkout configurations — a hosted Whop checkout for one plan. The purchase
// url is where the customer pays on Whop's page; on completion Whop redirects
// back to redirect_url. Metadata (including our minted reference) is inherited
// by the payment + membership created from the session, so the webhook can map
// the charge back to our intent.
// ---------------------------------------------------------------------------

export interface CreateCheckoutInput {
  /** Whop plan id (plan_…). */
  planId: string;
  /** Where Whop sends the customer after paying. */
  redirectUrl: string;
  /** Inherited by the payment/membership — carries our reference etc. */
  metadata?: Record<string, string>;
}

export interface CreateCheckoutResult {
  /** Whop checkout configuration id (ch_…). */
  checkoutId: string;
  /** The Whop-hosted checkout URL to redirect the customer to. */
  purchaseUrl: string;
}

/** POST /checkout_configurations — open a hosted checkout for one plan. */
export async function createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
  const accountId = whopAccountId();
  if (!accountId) {
    throw new WhopApiError(503, "Whop payments are not configured (WHOP_ACCOUNT_ID is missing)");
  }
  const json = await whopRequest<{ id: string; purchase_url: string }>("/checkout_configurations", {
    method: "POST",
    body: JSON.stringify({
      account_id: accountId,
      plan_id: input.planId,
      redirect_url: input.redirectUrl,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
  });
  return { checkoutId: json.id, purchaseUrl: json.purchase_url };
}

/**
 * Hide Whop's email input on the checkout page. Whop exposes no API field for
 * this — it is driven by URL parameters on the purchase URL:
 *
 *   email=<address>     fills the field in
 *   email.hidden=1      hides it entirely (email.disabled=1 locks it instead)
 *
 * We already know the customer's address from Clerk, so we pass it and hide the
 * input rather than asking for the same address twice. Without an address the
 * field must stay visible, otherwise the customer has no way to enter one and
 * cannot pay at all.
 *
 * https://docs.whop.com/manage-your-business/payment-processing/checkout-branding
 */
export function withKnownEmail(purchaseUrl: string, email: string | null): string {
  if (!email) return purchaseUrl;
  try {
    const url = new URL(purchaseUrl);
    url.searchParams.set("email", email);
    url.searchParams.set("email.hidden", "1");
    return url.toString();
  } catch {
    // A URL we cannot parse must never break a checkout Whop already opened.
    return purchaseUrl;
  }
}

// ---------------------------------------------------------------------------
// Memberships — the admin auto-renew toggle maps to Whop's cancel_at_period_end
// flag: on keeps billing, off stops renewals at the end of the current period
// (access stays until then). No card tokens live in our database — Whop owns
// the saved payment method.
// ---------------------------------------------------------------------------

/** PATCH /memberships/{id} — turn auto-renewal on (false) or off (true). */
export async function setMembershipAutoRenew(membershipId: string, enabled: boolean): Promise<void> {
  await whopRequest(`/memberships/${encodeURIComponent(membershipId)}`, {
    method: "PATCH",
    body: JSON.stringify({ cancel_at_period_end: !enabled }),
  });
}

// ---------------------------------------------------------------------------
// Webhook verification — Standard Webhooks spec. Whop signs
// `{webhook-id}.{webhook-timestamp}.{raw body}` with HMAC-SHA256 keyed by the
// ws_… webhook secret; the webhook-signature header is `v1,<base64>`. The
// timestamp must be within 5 minutes to block replay attacks. Always verify
// against the RAW body exactly as received.
// ---------------------------------------------------------------------------

export interface WhopWebhookHeaders {
  "webhook-id"?: string | string[] | undefined;
  "webhook-timestamp"?: string | string[] | undefined;
  "webhook-signature"?: string | string[] | undefined;
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function whopSignatureValid(rawBody: string | Buffer, headers: WhopWebhookHeaders): boolean {
  const secret = whopWebhookSecret();
  const id = first(headers["webhook-id"]);
  const timestamp = first(headers["webhook-timestamp"]);
  const signature = first(headers["webhook-signature"]);
  if (!secret || !id || !timestamp || !signature) return false;

  // Reject events older than 5 minutes (replay protection).
  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  if (Math.abs(Date.now() / 1000 - sent) > 5 * 60) return false;

  // The header is `v1,<base64 hmac-sha256>`; the secret is used as-is (ws_…).
  const [version, theirBase64] = signature.split(",", 2);
  if (version !== "v1" || !theirBase64) return false;

  const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(theirBase64);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Payments — what Whop reports for a verified payment (the `data` object of
// payment.* webhooks / GET /payments/{id}). Amounts are WHOLE DOLLARS and the
// currency is lowercase — convert to cents before comparing with the intent.
// ---------------------------------------------------------------------------

export interface WhopPayment {
  id: string;
  status: string;
  /** Friendly status (e.g. "succeeded") — decisions use `paid_at`, not this. */
  substatus?: string | null;
  /** ISO timestamp, set only once the charge succeeded (null while pending). */
  paid_at?: string | null;
  /** ISO timestamp of the refund, when the payment was refunded. */
  refunded_at?: string | null;
  refunded_amount?: number | null;
  /** Disputes (chargebacks) against this payment; empty when there are none. */
  disputes?: Array<{ id?: string; status?: string | null }> | null;
  /** Total charged in whole dollars (e.g. 5.88 for $5.88). */
  total?: number | null;
  /** Settlement amount in whole dollars — fallback when `total` is absent. */
  usd_total?: number | null;
  currency?: string | null;
  card_last4?: string | null;
  card_brand?: string | null;
  billing_reason?: string | null;
  plan?: { id?: string | null } | null;
  membership?: { id?: string | null } | null;
  /** The metadata attached at checkout — carries our minted reference. */
  metadata?: Record<string, unknown> | null;
}

/** Amount in USD cents from a Whop payment (dollars → cents). */
export function whopPaymentAmountCents(payment: WhopPayment): number | null {
  const dollars = payment.total ?? payment.usd_total;
  if (typeof dollars !== "number" || !Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/** Normalize a Whop currency string ("usd") for comparison with ours ("USD"). */
export function whopCurrencyMatches(currency: string | null | undefined, expected: string): boolean {
  return typeof currency === "string" && currency.toUpperCase() === expected.toUpperCase();
}

/**
 * Whether a Whop payment actually settled. Whop sets `paid_at` only once the
 * charge succeeds ("Null if the payment has not yet succeeded") and reports
 * `status: "paid"`; accepting either means a tweak to one field cannot silently
 * block every grant. Everything else — pending, draft, uncollectible,
 * unresolved, void — is not a success and must never grant an entitlement.
 */
export function whopPaymentSucceeded(payment: WhopPayment): boolean {
  if (typeof payment.paid_at === "string" && payment.paid_at.length > 0) return true;
  return payment.status === "paid";
}

/** Whether a settled payment has since been (partly or fully) refunded. */
export function whopPaymentRefunded(payment: WhopPayment): boolean {
  if (typeof payment.refunded_at === "string" && payment.refunded_at.length > 0) return true;
  return typeof payment.refunded_amount === "number" && payment.refunded_amount > 0;
}

/**
 * Look up the payment a checkout reference produced. The reference rides on the
 * checkout-configuration metadata and Whop copies it onto the payment — the
 * same mapping the payment.succeeded webhook matches on, just pulled instead of
 * pushed. This is what lets the app verify a purchase when no webhook arrived.
 *
 * `since` bounds the scan to payments created around the intent so the page we
 * read stays small. Returns null when Whop has no matching payment yet.
 */
export async function findPaymentByReference(
  reference: string,
  since: Date,
): Promise<WhopPayment | null> {
  const payments = await listPaymentsSince(since);
  const match = payments.find((payment) => {
    const ref = payment.metadata?.reference;
    return typeof ref === "string" && ref === reference;
  });
  return match ?? null;
}

/**
 * GET /payments — every payment on the account created since `since` (newest
 * first, one page). Callers filter; the reconcile sweep walks all of them.
 */
export async function listPaymentsSince(since: Date, first = 50): Promise<WhopPayment[]> {
  const accountId = whopAccountId();
  const params = new URLSearchParams({ first: String(first) });
  if (accountId) params.set("company_id", accountId);
  // A minute of slack for clock skew between us and Whop.
  params.set("created_after", new Date(since.getTime() - 60_000).toISOString());

  const json = await whopRequest<{ data?: WhopPayment[] }>(`/payments?${params.toString()}`, {
    method: "GET",
  });
  return Array.isArray(json?.data) ? json.data : [];
}

/** GET /payments/{id} — null when Whop has no such payment. */
export async function fetchPaymentById(paymentId: string): Promise<WhopPayment | null> {
  try {
    return await whopRequest<WhopPayment>(`/payments/${encodeURIComponent(paymentId)}`, {
      method: "GET",
    });
  } catch (cause) {
    if (cause instanceof WhopApiError && cause.status === 404) return null;
    throw cause;
  }
}

/** The full amount charged, in whole dollars (Whop's reporting unit). */
export function whopPaymentTotal(payment: WhopPayment): number | null {
  const dollars = payment.total ?? payment.usd_total;
  return typeof dollars === "number" && Number.isFinite(dollars) ? dollars : null;
}

/**
 * Whether the *whole* charge was given back. A partial refund leaves the
 * customer with what they paid for, so callers must not revoke on it.
 */
export function whopPaymentFullyRefunded(payment: WhopPayment): boolean {
  const refunded = payment.refunded_amount;
  if (typeof refunded !== "number" || refunded <= 0) {
    // No amount reported, but `refunded_at` says a refund happened — with
    // nothing to compare against, assume the whole charge went back.
    return typeof payment.refunded_at === "string" && payment.refunded_at.length > 0;
  }
  const total = whopPaymentTotal(payment);
  // Whop reports whole dollars; allow a cent for rounding.
  return total === null || total <= 0 || refunded >= total - 0.01;
}

/**
 * Dispute statuses that mean a chargeback is still in play. Whop keeps decided
 * disputes in the payment's list, so anything outside this set is a terminal
 * outcome — which is what lets a *won* dispute restore access again.
 * `refreshSubscriptionForPayment` logs the statuses it observes, so this set can
 * be extended if Whop introduces another in-flight state.
 */
const OPEN_DISPUTE_STATUSES = new Set([
  "needs_response",
  "warning_needs_response",
  "under_review",
  "warning_under_review",
]);

/** Whether a chargeback against this payment is still unresolved. */
export function whopPaymentHasOpenDispute(payment: WhopPayment): boolean {
  const disputes = Array.isArray(payment.disputes) ? payment.disputes : [];
  return disputes.some((dispute) => {
    const status = dispute?.status;
    return typeof status === "string" && OPEN_DISPUTE_STATUSES.has(status);
  });
}