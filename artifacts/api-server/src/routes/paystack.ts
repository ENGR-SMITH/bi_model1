import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import { db, tandemPaystackIntentsTable } from "@workspace/db";
import {
  applySubscriptionPurchase,
  resolveSubscriptionProduct,
  unknownProductMessage,
  type SubscriptionKind,
} from "../video/subscriptions";
import { resolvePromo } from "./tickets";
import {
  initializeTransaction,
  paystackSecretKey,
  paystackSignatureValid,
  verifyTransaction,
  PaystackApiError,
  type PaystackTransaction,
} from "../lib/paystack";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Paystack — hosted checkout for subscriptions, USD only. The buy buttons no
// longer collect card details: the server opens a Paystack checkout session
// (POST /paystack/checkout), the customer pays on Paystack's page, and the
// entitlement is granted exactly once from either the charge.success webhook
// or the post-redirect verify call (POST /paystack/confirm). Grants funnel
// through applySubscriptionPurchase, the same path the card checkout uses.
// ---------------------------------------------------------------------------

type CheckoutKind = "pass" | "storage" | "projects";

function parseKind(raw: unknown): CheckoutKind | null {
  if (raw === "pass" || raw === "storage" || raw === "projects") return raw;
  return null;
}

function validCallbackUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^https?:\/\/[^\s]+$/i.test(value) || value.length > 2000) return null;
  return value;
}

function defaultCallbackUrl(): string {
  const web = process.env.TANDEM_WEB_URL?.replace(/\/+$/, "");
  return `${web || "http://localhost:5175"}/subscriptions`;
}

async function lookupIntent(reference: string) {
  const [intent] = await db
    .select()
    .from(tandemPaystackIntentsTable)
    .where(eq(tandemPaystackIntentsTable.reference, reference))
    .limit(1);
  return intent ?? null;
}

async function markIntent(reference: string, status: "PENDING" | "SUCCESS" | "FAILED", cardLast4?: string | null) {
  await db
    .update(tandemPaystackIntentsTable)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "SUCCESS" && cardLast4 ? { cardLast4 } : {}),
    })
    .where(eq(tandemPaystackIntentsTable.reference, reference));
}

/**
 * Grant the entitlement behind a Paystack intent, exactly once. Returns:
 *  - "granted"       — this call applied the purchase
 *  - "already"       — the intent was already SUCCESS (webhook/confirm raced)
 *  - "mismatch"      — the paid amount/currency does not match the intent
 *  - null            — no intent exists for the reference
 * Throws if the grant itself fails (after resetting the intent so a webhook
 * retry can complete it).
 */
async function grantIntent(
  reference: string,
  options: { amount?: number; currency?: string; cardLast4?: string | null } = {},
): Promise<"granted" | "already" | "mismatch" | null> {
  const intent = await lookupIntent(reference);
  if (!intent) return null;
  if (intent.status === "SUCCESS") return "already";

  if (
    (options.amount !== undefined && options.amount !== intent.amountUsd) ||
    (options.currency !== undefined && options.currency !== intent.currency)
  ) {
    await markIntent(reference, "FAILED");
    logger.warn({ reference, expected: intent.amountUsd, paid: options.amount }, "paystack amount/currency mismatch — intent marked FAILED");
    return "mismatch";
  }

  const claimed = await db
    .update(tandemPaystackIntentsTable)
    .set({ status: "SUCCESS", updatedAt: new Date(), ...(options.cardLast4 ? { cardLast4: options.cardLast4 } : {}) })
    .where(and(eq(tandemPaystackIntentsTable.reference, reference), eq(tandemPaystackIntentsTable.status, "PENDING")))
    .returning();
  if (claimed.length === 0) return "already";

  try {
    await applySubscriptionPurchase({
      userId: intent.userId,
      kind: intent.kind as SubscriptionKind,
      planId: intent.planId,
      planLabel: intent.planLabel,
      priceUsd: intent.amountUsd,
      intervalLabel: intent.intervalLabel,
      promoCode: intent.promoCode,
      cardLast4: options.cardLast4 ?? intent.cardLast4,
      source: "checkout",
    });
  } catch (cause) {
    // Reset so a webhook retry (or a later confirm) can complete the grant.
    await markIntent(reference, "PENDING").catch(() => {});
    throw cause;
  }
  return "granted";
}

// POST /paystack/checkout — resolve the plan, mint an intent, and open a
// hosted Paystack checkout. Returns the authorization_url the client should
// redirect to. No card data is ever accepted here.
router.post("/paystack/checkout", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!paystackSecretKey()) {
    res.status(503).json({ error: "Payments are not configured on this server" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const kind = parseKind(body.kind);
  const planId = typeof body.planId === "string" ? body.planId : "";
  const promoCode = typeof body.promoCode === "string" && body.promoCode.trim() ? body.promoCode.trim() : undefined;

  if (!kind) {
    res.status(400).json({ error: "A subscription kind (pass, storage, or projects) is required" });
    return;
  }
  if (!planId) {
    res.status(400).json({ error: "A plan id is required" });
    return;
  }

  const product = resolveSubscriptionProduct(kind, planId);
  if (!product) {
    res.status(400).json({ error: unknownProductMessage(kind, planId) });
    return;
  }

  const promo = await resolvePromo(promoCode, product.priceUsd);
  if (promoCode && !promo) {
    res.status(400).json({ error: "That promo code is not valid" });
    return;
  }
  const total = Math.max(0, product.priceUsd - (promo?.discount ?? 0));

  // A FREE promo (or full discount) needs no charge — grant immediately.
  if (total === 0) {
    await applySubscriptionPurchase({
      userId,
      kind,
      planId,
      planLabel: product.planLabel,
      priceUsd: 0,
      intervalLabel: product.intervalLabel,
      promoCode: promo?.code ?? null,
      cardLast4: null,
      source: "checkout",
    });
    res.status(201).json({ granted: true, checkoutUrl: null, reference: null });
    return;
  }

  // Paystack requires the customer email; resolve it from Clerk.
  let email: string | null = null;
  try {
    const user = await clerkClient.users.getUser(userId);
    email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? null;
  } catch (cause) {
    logger.warn({ userId }, "paystack checkout: failed to resolve clerk user");
  }
  if (!email) {
    res.status(400).json({ error: "A verified email address is required to pay" });
    return;
  }

  const reference = `tan_${randomUUID()}`;
  const callbackUrl = validCallbackUrl(body.callbackUrl) ?? defaultCallbackUrl();

  await db.insert(tandemPaystackIntentsTable).values({
    reference,
    userId,
    kind,
    planId,
    planLabel: product.planLabel,
    intervalLabel: product.intervalLabel,
    amountUsd: total,
    currency: "USD",
    status: "PENDING",
    promoCode: promo?.code ?? null,
  });

  try {
    const { authorizationUrl } = await initializeTransaction({
      email,
      amount: total,
      reference,
      callbackUrl,
      metadata: { userId, kind, planId, promoCode: promo?.code ?? null },
    });
    res.status(201).json({ granted: false, checkoutUrl: authorizationUrl, reference });
  } catch (cause) {
    // Roll the intent back so nothing lingers as PENDING.
    await db.delete(tandemPaystackIntentsTable).where(eq(tandemPaystackIntentsTable.reference, reference)).catch(() => {});
    const message = cause instanceof PaystackApiError ? cause.message : "Paystack could not open the checkout session";
    res.status(502).json({ error: message });
  }
});

// POST /paystack/webhook — Paystack pushes charge.success / charge.failed here.
// Signature-verified with the secret key over the RAW body (captured by the
// express.json verify hook in app.ts). Always answers 200 once handled.
router.post("/paystack/webhook", async (req: Request, res: Response): Promise<void> => {
  const rawBody = String((req as Request & { rawBody?: Buffer }).rawBody ?? "");
  const signature = req.headers["x-paystack-signature"];
  if (!paystackSignatureValid(rawBody, typeof signature === "string" ? signature : signature?.[0] ?? null)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = (req.body ?? {}) as {
    event?: string;
    data?: { reference?: string; amount?: number; currency?: string; authorization?: { last4?: string | null } | null };
  };
  const event = payload.event ?? "";
  const data = payload.data ?? {};
  const reference = typeof data.reference === "string" ? data.reference : "";

  if (!reference) {
    res.status(200).json({ received: true });
    return;
  }

  try {
    if (event === "charge.success") {
      const result = await grantIntent(reference, {
        amount: typeof data.amount === "number" ? data.amount : undefined,
        currency: typeof data.currency === "string" ? data.currency : undefined,
        cardLast4: data.authorization?.last4 ?? null,
      });
      if (result === null) logger.warn({ reference }, "paystack webhook: unknown reference (ignored)");
    } else if (event === "charge.failed" || event === "charge.void" || event === "charge.abandoned") {
      const intent = await lookupIntent(reference);
      if (intent && intent.status === "PENDING") await markIntent(reference, "FAILED");
    }
    res.status(200).json({ received: true });
  } catch (cause) {
    logger.error({ reference, err: cause }, "paystack webhook: grant failed");
    res.status(500).json({ error: "Grant failed" });
  }
});

// POST /paystack/confirm — called from the app's return page after Paystack
// redirects the customer back. Server-side verify of the charge, then the same
// idempotent grant as the webhook. Only the user who owns the intent may
// confirm it.
router.post("/paystack/confirm", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!reference) {
    res.status(400).json({ error: "A transaction reference is required" });
    return;
  }

  const intent = await lookupIntent(reference);
  if (!intent) {
    res.status(404).json({ error: "No checkout found for that reference" });
    return;
  }
  if (intent.userId !== userId) {
    res.status(403).json({ error: "That checkout belongs to another account" });
    return;
  }

  let txn: PaystackTransaction;
  try {
    txn = await verifyTransaction(reference);
  } catch (cause) {
    if (cause instanceof PaystackApiError && cause.status === 404) {
      res.status(404).json({ error: "Paystack does not know that reference" });
      return;
    }
    res.status(502).json({ error: cause instanceof PaystackApiError ? cause.message : "Could not verify the payment with Paystack" });
    return;
  }

  const cardLast4 = txn.authorization?.last4 ?? intent.cardLast4 ?? null;
  const paidSuccessfully = txn.status === "success" && txn.currency === "USD" && txn.amount === intent.amountUsd;

  if (!paidSuccessfully && intent.status !== "SUCCESS") {
    if (txn.status === "failed" || txn.status === "abandoned") {
      if (intent.status === "PENDING") await markIntent(reference, "FAILED");
    }
    res.status(200).json({
      granted: false,
      status: intent.status === "SUCCESS" ? "success" : txn.status,
      error:
        intent.status === "SUCCESS"
          ? undefined
          : txn.status !== "success"
            ? "The payment did not complete. Try again if you were not charged."
            : "The payment amount did not match — contact support before retrying.",
    });
    return;
  }

  // Success (or already granted by the webhook while we verified) — make sure
  // the grant has happened, then hand back the receipt for the success UI.
  const result = await grantIntent(reference, { amount: txn.amount, currency: txn.currency, cardLast4 });
  if (result === "mismatch") {
    res.status(402).json({ error: "The payment amount did not match — contact support." });
    return;
  }

  res.status(200).json({
    granted: true,
    receipt: {
      total: intent.amountUsd,
      cardLast4,
      promoCode: intent.promoCode,
    },
  });
});

export default router;
