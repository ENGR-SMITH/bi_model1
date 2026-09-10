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
      title: input.title,
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