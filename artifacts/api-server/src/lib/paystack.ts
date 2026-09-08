import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Paystack — thin client for the Paystack REST API (hosted checkout, USD).
// Every request authenticates with the server-only secret key
// (PAYSTACK_SECRET_KEY) as `Authorization: Bearer sk_…`. Webhook events are
// verified by recomputing the HMAC-SHA512 signature over the raw body with the
// same secret key — there is no separate webhook secret.
// ---------------------------------------------------------------------------

export const PAYSTACK_API_BASE = "https://api.paystack.co";
// The account settles in USD; amounts are the smallest unit (cents), which is
// exactly the `priceUsd` unit used across the subscription plans.
export const PAYSTACK_CURRENCY = "USD" as const;

/** Server-only secret key from the dashboard (sk_test_… / sk_live_…). */
export function paystackSecretKey(): string {
  return process.env.PAYSTACK_SECRET_KEY ?? "";
}

export class PaystackApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface PaystackResponse {
  status: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

async function paystackRequest<T = PaystackResponse>(
  path: string,
  init: { method: "GET" | "POST"; body?: string },
): Promise<T> {
  const secret = paystackSecretKey();
  if (!secret) {
    throw new PaystackApiError(503, "Payments are not configured on this server (PAYSTACK_SECRET_KEY is missing)");
  }
  let res: Response;
  try {
    res = await fetch(`${PAYSTACK_API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body,
    });
  } catch (cause) {
    throw new PaystackApiError(502, `Paystack is unreachable (${init.method} ${path})`);
  }

  const text = await res.text();
  let json: PaystackResponse | null = null;
  try {
    json = text ? (JSON.parse(text) as PaystackResponse) : null;
  } catch {
    json = null;
  }

  if (!res.ok || json === null || json.status === false) {
    throw new PaystackApiError(
      res.status,
      json?.message ?? `Paystack ${init.method} ${path} failed (HTTP ${res.status})`,
    );
  }
  return json as T;
}

export interface InitializeTransactionInput {
  email: string;
  /** Amount in USD cents (e.g. 588 for $5.88). */
  amount: number;
  /** Unique transaction reference minted server-side. */
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  /** Paystack plan code (PLN_…) — when set, the transaction subscribes the
      customer to the plan and Paystack charges the plan's own amount (the
      `amount` passed above is then ignored for billing). */
  plan?: string;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  reference: string;
}

/** POST /transaction/initialize — creates a hosted Paystack checkout session. */
export async function initializeTransaction(
  input: InitializeTransactionInput,
): Promise<InitializeTransactionResult> {
  const json = await paystackRequest<{ status: boolean; data: { authorization_url: string; reference: string } }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: input.amount,
        currency: PAYSTACK_CURRENCY,
        reference: input.reference,
        ...(input.plan ? { plan: input.plan } : {}),
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
    },
  );
  return { authorizationUrl: json.data.authorization_url, reference: json.data.reference };
}

/**
 * POST /plan — mirror a catalog plan as a Paystack recurring plan. Returns the
 * plan code (PLN_…) that checkout passes to initialize to subscribe customers.
 * Plans are created once per (kind, planId) and cached in tandem_paystack_plans.
 */
export interface CreatePlanInput {
  name: string;
  /** Amount in USD cents (the monthly price). */
  amount: number;
  /** "monthly" for every subscription plan here. */
  interval: "daily" | "weekly" | "monthly" | "quarterly" | "biannually" | "annually";
  currency?: string;
}

export interface CreatePlanResult {
  planCode: string;
}

export async function createPlan(input: CreatePlanInput): Promise<CreatePlanResult> {
  const json = await paystackRequest<{ status: boolean; data: { plan_code: string } }>("/plan", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      amount: input.amount,
      interval: input.interval,
      currency: input.currency ?? PAYSTACK_CURRENCY,
    }),
  });
  return { planCode: json.data.plan_code };
}

/**
 * POST /subscription/disable — stop Paystack from charging a subscription
 * (admin turning auto-renewal off). Requires the subscription code and the
 * email token captured at checkout.
 */
export async function disableSubscription(code: string, token: string): Promise<void> {
  await paystackRequest("/subscription/disable", {
    method: "POST",
    body: JSON.stringify({ code, token }),
  });
}

/** POST /subscription/enable — resume charging a disabled subscription. */
export async function enableSubscription(code: string, token: string): Promise<void> {
  await paystackRequest("/subscription/enable", {
    method: "POST",
    body: JSON.stringify({ code, token }),
  });
}

/** What Paystack reports for a verified transaction (the `data` object). */
export interface PaystackTransaction {
  status: string;
  amount: number;
  currency: string;
  reference: string;
  paid_at?: string | null;
  authorization?: PaystackAuthorization | null;
  customer?: { customer_code?: string | null; email?: string | null } | null;
  metadata?: Record<string, unknown> | null;
  /** Present on plan-based transactions — which plan the charge was for. */
  plan?: { plan_code?: string | null } | null;
  /** Present on subscription charges — which recurring subscription billed. */
  subscription?: {
    subscription_code?: string | null;
    email_token?: string | null;
    status?: string | null;
  } | null;
}

export interface PaystackAuthorization {
  last4?: string | null;
  channel?: string | null;
  // The reusable card token — kept (server-only) when the customer opts into
  // auto-renewal so the renewal scheduler can re-charge without a checkout.
  authorization_code?: string | null;
  card_type?: string | null;
  bank?: string | null;
  bin?: string | null;
  exp_month?: string | null;
  exp_year?: string | null;
}

/** GET /transaction/verify/:reference — server-side confirmation of a charge. */
export async function verifyTransaction(reference: string): Promise<PaystackTransaction> {
  const json = await paystackRequest<{ status: boolean; data: PaystackTransaction }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
    { method: "GET" },
  );
  return json.data;
}

/**
 * POST /transaction/charge_authorization — re-charge a previously authorized
 * card (server-managed auto-renewal). The outcome lands as a normal
 * charge.success / charge.failed webhook against the minted reference; a
 * synchronous API error (declined authorization, missing card) throws.
 */
export interface ChargeAuthorizationInput {
  email: string;
  /** Amount in USD cents. */
  amount: number;
  authorizationCode: string;
  /** Unique reference minted server-side (the renewal intent's reference). */
  reference: string;
  metadata?: Record<string, unknown>;
}

export async function chargeAuthorization(input: ChargeAuthorizationInput): Promise<void> {
  await paystackRequest<{ status: boolean; data?: Record<string, unknown> }>(
    "/transaction/charge_authorization",
    {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        amount: input.amount,
        currency: PAYSTACK_CURRENCY,
        authorization_code: input.authorizationCode,
        reference: input.reference,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
    },
  );
}

/**
 * True when `signature` (the `x-paystack-signature` header) is the HMAC-SHA512
 * of the raw request body, keyed by the Paystack secret key. Use the raw body
 * exactly as received — never a re-serialized JSON object.
 */
export function paystackSignatureValid(rawBody: string | Buffer, signature: string | undefined | null): boolean {
  if (!signature) return false;
  const secret = paystackSecretKey();
  if (!secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && timingSafeEqual(a, b);
}
