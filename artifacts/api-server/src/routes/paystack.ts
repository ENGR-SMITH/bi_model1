import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import {
  db,
  nexetPaystackIntentsTable,
  nexetPaystackPlansTable,
  nexetSubscriptionsTable,
} from "@workspace/db";
import {
  applySubscriptionPurchase,
  autoRenewAvailableForPlan,
  resolveSubscriptionProduct,
  unknownProductMessage,
  type SubscriptionKind,
} from "../video/subscriptions";
import { resolvePromo } from "./tickets";
import {
  createPlan,
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
// Paystack — hosted checkout for subscriptions, USD only, billed monthly by
// Paystack's own recurring plans. The buy buttons no longer collect card
// details: the server mirrors each catalog plan as a Paystack plan (POST
// /plan), opens a checkout (POST /paystack/checkout) that subscribes the
// customer to it, and Paystack charges the plan amount every month on its own.
// The entitlement is granted exactly once from either the charge.success
// webhook or the post-redirect verify call (POST /paystack/confirm). Recurring
// charges arrive as charge.success events with a subscription code but no
// intent, and are granted from the live subscription row. Grants funnel
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
  const web = process.env.NEXET_WEB_URL?.replace(/\/+$/, "");
  return `${web || "http://localhost:5175"}/subscriptions`;
}

async function lookupIntent(reference: string) {
  const [intent] = await db
    .select()
    .from(nexetPaystackIntentsTable)
    .where(eq(nexetPaystackIntentsTable.reference, reference))
    .limit(1);
  return intent ?? null;
}

async function markIntent(reference: string, status: "PENDING" | "SUCCESS" | "FAILED", cardLast4?: string | null) {
  await db
    .update(nexetPaystackIntentsTable)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "SUCCESS" && cardLast4 ? { cardLast4 } : {}),
    })
    .where(eq(nexetPaystackIntentsTable.reference, reference));
}

/**
 * The Paystack plan code for a catalog plan, creating the Paystack plan once
 * and caching it in nexet_paystack_plans so later checkouts reuse it.
 */
async function getOrCreatePlan(
  kind: SubscriptionKind,
  planId: string,
  amountUsd: number,
  planLabel: string,
): Promise<string> {
  const [existing] = await db
    .select({ planCode: nexetPaystackPlansTable.planCode })
    .from(nexetPaystackPlansTable)
    .where(and(eq(nexetPaystackPlansTable.kind, kind), eq(nexetPaystackPlansTable.planId, planId)))
    .limit(1);
  if (existing) return existing.planCode;

  const { planCode } = await createPlan({
    name: `${planLabel} (Monthly)`,
    amount: amountUsd,
    interval: "monthly",
  });
  await db
    .insert(nexetPaystackPlansTable)
    .values({ kind, planId, planCode, amountUsd, interval: "monthly" })
    .onConflictDoNothing();
  return planCode;
}

/**
 * The monthly price a subscription's plan charges, in USD cents — what a
 * recurring charge must match before it is granted.
 */
function planAmountUsd(kind: string, planId: string): number | null {
  return resolveSubscriptionProduct(kind as SubscriptionKind, planId)?.priceUsd ?? null;
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
interface ChargeOptions {
  amount?: number;
  currency?: string;
  cardLast4?: string | null;
  authorizationCode?: string | null;
  customerCode?: string | null;
  customerEmail?: string | null;
  /** Paystack plan this charge billed on (PLN_…). */
  planCode?: string | null;
  /** Recurring subscription that produced this charge (SUB_… + email token). */
  subscriptionCode?: string | null;
  emailToken?: string | null;
}

async function grantIntent(
  reference: string,
  options: ChargeOptions = {},
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
    .update(nexetPaystackIntentsTable)
    .set({ status: "SUCCESS", updatedAt: new Date(), ...(options.cardLast4 ? { cardLast4: options.cardLast4 } : {}) })
    .where(and(eq(nexetPaystackIntentsTable.reference, reference), eq(nexetPaystackIntentsTable.status, "PENDING")))
    .returning();
  if (claimed.length === 0) return "already";

  // Auto-renewal context: a checkout signed up with autoRenew keeps the card
  // authorization returned by the charge; a renewal intent reuses the card on
  // the subscription row it is renewing (the row keeps the authorization).
  let autoRenew = intent.autoRenew === true;
  let authorizationCode = options.authorizationCode ?? null;
  let customerCode = options.customerCode ?? null;
  let customerEmail = options.customerEmail ?? intent.customerEmail ?? null;
  let planCode = options.planCode ?? null;
  let subscriptionCode = options.subscriptionCode ?? null;
  let emailToken = options.emailToken ?? null;
  const renewsSubscriptionId = intent.renewalFor ?? null;
  if (renewsSubscriptionId) {
    const [oldSub] = await db
      .select()
      .from(nexetSubscriptionsTable)
      .where(eq(nexetSubscriptionsTable.id, renewsSubscriptionId))
      .limit(1);
    if (oldSub) {
      autoRenew = true;
      authorizationCode = oldSub.paystackAuthorizationCode ?? authorizationCode;
      customerCode = oldSub.paystackCustomerCode ?? customerCode;
      customerEmail = oldSub.paystackEmail ?? customerEmail;
      planCode = oldSub.paystackPlanCode ?? planCode;
      subscriptionCode = oldSub.paystackSubscriptionCode ?? subscriptionCode;
      emailToken = oldSub.paystackEmailToken ?? emailToken;
    }
  }

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
      autoRenew,
      paystackAuthorizationCode: authorizationCode,
      paystackCustomerCode: customerCode,
      paystackEmail: customerEmail,
      paystackPlanCode: planCode,
      paystackSubscriptionCode: subscriptionCode,
      paystackEmailToken: emailToken,
      paystackTransactionReference: reference,
      renewsSubscriptionId,
    });
  } catch (cause) {
    // Reset so a webhook retry (or a later confirm) can complete the grant.
    await markIntent(reference, "PENDING").catch(() => {});
    throw cause;
  }
  return "granted";
}

/**
 * Grant a recurring subscription charge — a charge.success whose reference has
 * no intent (Paystack billed the plan automatically). The charge is matched to
 * the live auto-renewing subscription row by its Paystack subscription code,
 * verified against the plan's monthly price, and granted as the next row in
 * the chain (the previous row stops being the live record).
 */
async function grantSubscriptionCharge(
  reference: string,
  options: ChargeOptions,
): Promise<"granted" | "already" | "mismatch" | null> {
  if (!options.subscriptionCode) return null;
  const [sub] = await db
    .select()
    .from(nexetSubscriptionsTable)
    .where(
      and(
        eq(nexetSubscriptionsTable.paystackSubscriptionCode, options.subscriptionCode),
        eq(nexetSubscriptionsTable.autoRenew, true),
      ),
    )
    .orderBy(desc(nexetSubscriptionsTable.createdAt))
    .limit(1);
  if (!sub) return null;

  const expected = planAmountUsd(sub.kind, sub.planId);
  if (expected === null || (options.amount !== undefined && options.amount !== expected)) {
    logger.warn(
      { subscriptionCode: options.subscriptionCode, expected, paid: options.amount },
      "paystack recurring charge amount mismatch — not granted",
    );
    return "mismatch";
  }

  await applySubscriptionPurchase({
    userId: sub.userId,
    kind: sub.kind as SubscriptionKind,
    planId: sub.planId,
    planLabel: sub.planLabel,
    priceUsd: expected,
    intervalLabel: sub.intervalLabel,
    cardLast4: options.cardLast4 ?? sub.cardLast4,
    source: "checkout",
    autoRenew: true,
    paystackAuthorizationCode: options.authorizationCode ?? sub.paystackAuthorizationCode,
    paystackCustomerCode: options.customerCode ?? sub.paystackCustomerCode,
    paystackEmail: options.customerEmail ?? sub.paystackEmail,
    paystackPlanCode: options.planCode ?? sub.paystackPlanCode,
    paystackSubscriptionCode: options.subscriptionCode,
    paystackEmailToken: options.emailToken ?? sub.paystackEmailToken,
    paystackTransactionReference: reference,
    renewsSubscriptionId: sub.id,
  });
  return "granted";
}

/**
 * Route one charge.success: idempotent per Paystack transaction reference,
 * then the intent path (first purchase) or the subscription path (recurring).
 */
async function handleChargeSuccess(
  reference: string,
  options: ChargeOptions,
): Promise<"granted" | "already" | "mismatch" | null> {
  // A Paystack transaction reference is never granted twice — covers both the
  // first charge and every recurring cycle.
  const [alreadyGranted] = await db
    .select({ id: nexetSubscriptionsTable.id })
    .from(nexetSubscriptionsTable)
    .where(eq(nexetSubscriptionsTable.paystackTransactionReference, reference))
    .limit(1);
  if (alreadyGranted) return "already";

  const granted = await grantIntent(reference, options);
  if (granted !== null) return granted;

  // No intent — Paystack billed the plan automatically; grant from the live
  // subscription instead.
  return grantSubscriptionCharge(reference, options);
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

  // Every Paystack subscription auto-renews by default: the card authorization
  // is kept and re-charged each cycle. Only an admin can turn it off — per
  // plan (a nexet_subscription_plan_settings row with autoRenewAvailable
  // false turns it off here) or per subscription (the admin toggle). Any
  // client-sent autoRenew flag is ignored.
  const autoRenew = await autoRenewAvailableForPlan(kind, planId);

  const product = resolveSubscriptionProduct(kind, planId);
  if (!product) {
    res.status(400).json({ error: unknownProductMessage(kind, planId) });
    return;
  }

  const promo = await resolvePromo(promoCode, product.priceUsd, userId);
  if (promoCode && !promo) {
    res.status(400).json({ error: "That promo code is not valid" });
    return;
  }
  // Paystack plans charge the full monthly plan amount — a percentage or
  // dollar-off promo cannot be applied to a subscription. Only 100%-off
  // (FREE) promos still apply, as a free month with no card and no renewal.
  if (promo && promo.kind !== "FREE") {
    res.status(400).json({
      error:
        "Percentage and dollar-off promo codes don't apply to monthly subscriptions — use a FREE promo, or subscribe without a code.",
    });
    return;
  }
  const total = Math.max(0, product.priceUsd - (promo?.discount ?? 0));

  // A FREE promo needs no charge — grant a free month with no subscription.
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

  // Mirror the catalog plan as a Paystack plan (once) and subscribe the
  // customer to it — Paystack then charges the plan amount every month.
  const planCode = await getOrCreatePlan(kind, planId, total, product.planLabel);

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

  await db.insert(nexetPaystackIntentsTable).values({
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
    autoRenew,
    customerEmail: email,
  });

  try {
    const { authorizationUrl } = await initializeTransaction({
      email,
      amount: total,
      reference,
      callbackUrl,
      plan: planCode,
      metadata: { userId, kind, planId, promoCode: promo?.code ?? null },
    });
    res.status(201).json({ granted: false, checkoutUrl: authorizationUrl, reference });
  } catch (cause) {
    // Roll the intent back so nothing lingers as PENDING.
    await db.delete(nexetPaystackIntentsTable).where(eq(nexetPaystackIntentsTable.reference, reference)).catch(() => {});
    const message = cause instanceof PaystackApiError ? cause.message : "Paystack could not open the checkout session";
    res.status(502).json({ error: message });
  }
});

// POST /paystack/webhook — Paystack pushes charge.success / charge.failed and
// the subscription lifecycle events (invoice.payment_failed, subscription.*)
// here. Signature-verified with the secret key over the RAW body (captured by
// the express.json verify hook in app.ts). Always answers 200 once handled.
router.post("/paystack/webhook", async (req: Request, res: Response): Promise<void> => {
  const rawBody = String((req as Request & { rawBody?: Buffer }).rawBody ?? "");
  const signature = req.headers["x-paystack-signature"];
  if (!paystackSignatureValid(rawBody, typeof signature === "string" ? signature : signature?.[0] ?? null)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = (req.body ?? {}) as {
    event?: string;
    data?: {
      reference?: string;
      amount?: number;
      currency?: string;
      authorization?: { last4?: string | null; authorization_code?: string | null } | null;
      customer?: { customer_code?: string | null; email?: string | null } | null;
      plan?: { plan_code?: string | null } | null;
      subscription?: { subscription_code?: string | null; email_token?: string | null; status?: string | null } | null;
    };
  };
  const event = payload.event ?? "";
  const data = payload.data ?? {};
  const reference = typeof data.reference === "string" ? data.reference : "";

  if (!reference && !data.subscription?.subscription_code) {
    res.status(200).json({ received: true });
    return;
  }

  try {
    if (event === "charge.success") {
      const result = await handleChargeSuccess(reference, {
        amount: typeof data.amount === "number" ? data.amount : undefined,
        currency: typeof data.currency === "string" ? data.currency : undefined,
        cardLast4: data.authorization?.last4 ?? null,
        authorizationCode: data.authorization?.authorization_code ?? null,
        customerCode: data.customer?.customer_code ?? null,
        customerEmail: data.customer?.email ?? null,
        planCode: data.plan?.plan_code ?? null,
        subscriptionCode: data.subscription?.subscription_code ?? null,
        emailToken: data.subscription?.email_token ?? null,
      });
      if (result === null) logger.warn({ reference }, "paystack webhook: unknown reference (ignored)");
    } else if (event === "charge.failed" || event === "charge.void" || event === "charge.abandoned") {
      const intent = await lookupIntent(reference);
      if (intent && intent.status === "PENDING") await markIntent(reference, "FAILED");
    } else if (event === "invoice.payment_failed") {
      // A monthly subscription charge was declined — surface it on the live row.
      const code = data.subscription?.subscription_code;
      if (code) {
        await db
          .update(nexetSubscriptionsTable)
          .set({
            renewalFailure:
              "The monthly charge was declined — update the card on your subscription or contact support.",
            updatedAt: new Date(),
          })
          .where(and(eq(nexetSubscriptionsTable.paystackSubscriptionCode, code), eq(nexetSubscriptionsTable.autoRenew, true)));
      }
    } else if (event === "subscription.disable") {
      // Cancelled or completed — stop treating the chain as auto-renewing.
      const code = data.subscription?.subscription_code;
      if (code) {
        await db
          .update(nexetSubscriptionsTable)
          .set({ autoRenew: false, updatedAt: new Date() })
          .where(eq(nexetSubscriptionsTable.paystackSubscriptionCode, code));
      }
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
  const result = await handleChargeSuccess(reference, {
    amount: txn.amount,
    currency: txn.currency,
    cardLast4,
    authorizationCode: txn.authorization?.authorization_code ?? null,
    customerCode: txn.customer?.customer_code ?? null,
    customerEmail: txn.customer?.email ?? null,
    planCode: txn.plan?.plan_code ?? null,
    subscriptionCode: txn.subscription?.subscription_code ?? null,
    emailToken: txn.subscription?.email_token ?? null,
  });
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
