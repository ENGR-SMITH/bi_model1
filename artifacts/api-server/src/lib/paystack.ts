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
  /** Amount in USD cents (e.g. 188 for $1.88). */
  amount: number;
  /** Unique transaction reference minted server-side. */
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
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
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
    },
  );
  return { authorizationUrl: json.data.authorization_url, reference: json.data.reference };
}

/** What Paystack reports for a verified transaction (the `data` object). */
export interface PaystackTransaction {
  status: string;
  amount: number;
  currency: string;
  reference: string;
  paid_at?: string | null;
  authorization?: { last4?: string | null; channel?: string | null } | null;
  metadata?: Record<string, unknown> | null;
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
