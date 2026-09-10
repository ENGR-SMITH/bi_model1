import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { clerkClient, getAuth } from "@clerk/express";
import {
  db,
  nexetWhopIntentsTable,
  nexetWhopPlansTable,
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
  createCheckout,
  createPlan,
  whopAccountId,
  whopApiKey,
  whopPaymentAmountCents,
  whopCurrencyMatches,
  whopSignatureValid,
  WhopApiError,
  WHOP_BILLING_PERIOD_DAYS,
  type WhopPayment,
} from "../lib/whop";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Whop — hosted checkout for subscriptions, USD only, billed monthly by Whop's
// own renewal plans. The buy buttons no longer collect card details: the
// server mirrors each catalog plan as a Whop renewal plan (POST /plans), opens
// a hosted checkout (POST /whop/checkout) that subscribes the customer to it,
// and Whop charges the plan amount every 30 days on its own. The entitlement
// is granted exactly once from either the payment.succeeded webhook or the
// post-redirect confirm call (POST /whop/confirm). Recurring charges arrive
// as payment.succeeded events with a membership but no intent, and are granted
// from the live subscription row. Grants funnel through
// applySubscriptionPurchase, the same path the card checkout uses.
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
    .from(nexetWhopIntentsTable)
    .where(eq(nexetWhopIntentsTable.reference, reference))
    .limit(1);
  return intent ?? null;
}

async function markIntent(reference: string, status: "PENDING" | "SUCCESS" | "FAILED", cardLast4?: string | null) {
  await db
    .update(nexetWhopIntentsTable)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "SUCCESS" && cardLast4 ? { cardLast4 } : {}),
    })
    .where(eq(nexetWhopIntentsTable.reference, reference));
}

/**
 * The Whop plan id for a catalog plan, creating the Whop renewal plan once and
 * caching it in nexet_whop_plans so later checkouts reuse it.
 */
async function getOrCreatePlan(
  kind: SubscriptionKind,
  planId: string,
  amountUsd: number,
  planLabel: string,
): Promise<string> {
  const [existing] = await db
    .select({ whopPlanId: nexetWhopPlansTable.whopPlanId })
    .from(nexetWhopPlansTable)
    .where(and(eq(nexetWhopPlansTable.kind, kind), eq(nexetWhopPlansTable.planId, planId)))
    .limit(1);
  if (existing) return existing.whopPlanId;

  const { whopPlanId } = await createPlan({
    title: `${planLabel} (Monthly)`,
    amountCents: amountUsd,
    billingPeriodDays: WHOP_BILLING_PERIOD_DAYS,
  });
  await db
    .insert(nexetWhopPlansTable)
    .values({ kind, planId, whopPlanId, amountUsd, billingPeriodDays: WHOP_BILLING_PERIOD_DAYS })
    .onConflictDoNothing();
  return whopPlanId;
}

/**
 * The monthly price a subscription's plan charges, in USD cents — what a
 * recurring charge must match before it is granted.
 */
function planAmountUsd(kind: string, planId: string): number | null {
  return resolveSubscriptionProduct(kind as SubscriptionKind, planId)?.priceUsd ?? null;
}

/**
 * Grant the entitlement behind a Whop intent, exactly once. Returns:
 *  - "granted"       — this call applied the purchase
 *  - "already"       — the intent was already SUCCESS (webhook/confirm raced)
 *  - "mismatch"      — the paid amount/currency does not match the intent
 *  - null            — no intent exists for the reference
 * Throws if the grant itself fails (after resetting the intent so a webhook
 * retry can complete it).
 */
interface ChargeOptions {
  amountCents?: number | null;
  currency?: string;
  cardLast4?: string | null;
  /** Whop membership (mem_…) this charge billed on. */
  membershipId?: string | null;
  /** Whop plan (plan_…) this charge billed on. */
  planId?: string | null;
  /** The customer email Whop holds for this member. */
  customerEmail?: string | null;
  /** The Whop payment (pay_…) this charge settled — stored on the
      subscription for webhook idempotency. */
  whopPaymentId?: string | null;
}

async function grantIntent(
  reference: string,
  options: ChargeOptions = {},
): Promise<"granted" | "already" | "mismatch" | null> {
  const intent = await lookupIntent(reference);
  if (!intent) return null;
  if (intent.status === "SUCCESS") return "already";

  if (
    (options.amountCents !== undefined && options.amountCents !== intent.amountUsd) ||
    (options.currency !== undefined && !whopCurrencyMatches(options.currency, intent.currency))
  ) {
    await markIntent(reference, "FAILED");
    logger.warn({ reference, expected: intent.amountUsd, paid: options.amountCents }, "whop amount/currency mismatch — intent marked FAILED");
    return "mismatch";
  }

  const claimed = await db
    .update(nexetWhopIntentsTable)
    .set({
      status: "SUCCESS",
      updatedAt: new Date(),
      ...(options.cardLast4 ? { cardLast4: options.cardLast4 } : {}),
      ...(options.membershipId ? { whopMembershipId: options.membershipId } : {}),
      ...(options.whopPaymentId ? { whopPaymentId: options.whopPaymentId } : {}),
    })
    .where(and(eq(nexetWhopIntentsTable.reference, reference), eq(nexetWhopIntentsTable.status, "PENDING")))
    .returning();
  if (claimed.length === 0) return "already";

  // Auto-renewal context: Whop manages the renewal through the membership
  // captured by the charge — no local authorization code is stored.
  const autoRenew = intent.autoRenew === true;
  let membershipId = options.membershipId ?? intent.whopMembershipId ?? null;
  const planId = options.planId ?? null;
  const customerEmail = options.customerEmail ?? intent.customerEmail ?? null;
  const renewsSubscriptionId = intent.renewalFor ?? null;
  if (renewsSubscriptionId) {
    const [oldSub] = await db
      .select()
      .from(nexetSubscriptionsTable)
      .where(eq(nexetSubscriptionsTable.id, renewsSubscriptionId))
      .limit(1);
    if (oldSub) {
      membershipId = oldSub.whopMembershipId ?? membershipId;
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
      whopMembershipId: membershipId,
      whopPlanId: planId,
      whopEmail: customerEmail,
      whopPaymentId: options.whopPaymentId ?? reference,
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
 * Grant a recurring subscription charge — a payment.succeeded whose metadata
 * has no intent reference (Whop billed the renewal plan automatically). The
 * charge is matched to the live auto-renewing subscription row by its Whop
 * membership, verified against the plan's monthly price, and granted as the
 * next row in the chain (the previous row stops being the live record).
 */
async function grantSubscriptionCharge(
  paymentId: string,
  options: ChargeOptions,
): Promise<"granted" | "already" | "mismatch" | null> {
  if (!options.membershipId) return null;
  const [sub] = await db
    .select()
    .from(nexetSubscriptionsTable)
    .where(
      and(
        eq(nexetSubscriptionsTable.whopMembershipId, options.membershipId),
        eq(nexetSubscriptionsTable.autoRenew, true),
      ),
    )
    .orderBy(desc(nexetSubscriptionsTable.createdAt))
    .limit(1);
  if (!sub) return null;

  const expected = planAmountUsd(sub.kind, sub.planId);
  if (expected === null || (options.amountCents !== undefined && options.amountCents !== expected)) {
    logger.warn(
      { membershipId: options.membershipId, expected, paid: options.amountCents },
      "whop recurring charge amount mismatch — not granted",
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
    whopMembershipId: options.membershipId,
    whopPlanId: options.planId ?? sub.whopPlanId,
    whopEmail: options.customerEmail ?? sub.whopEmail,
    whopPaymentId: paymentId,
    renewsSubscriptionId: sub.id,
  });
  return "granted";
}

/**
 * Route one payment.succeeded: idempotent per Whop payment id, then the
 * intent path (first purchase) or the membership path (recurring).
 */
async function handlePaymentSucceeded(
  payment: WhopPayment,
): Promise<"granted" | "already" | "mismatch" | null> {
  // A Whop payment is never granted twice — covers both the first charge and
  // every recurring cycle.
  const [alreadyGranted] = await db
    .select({ id: nexetSubscriptionsTable.id })
    .from(nexetSubscriptionsTable)
    .where(eq(nexetSubscriptionsTable.whopPaymentId, payment.id))
    .limit(1);
  if (alreadyGranted) return "already";

  const options: ChargeOptions = {
    amountCents: whopPaymentAmountCents(payment),
    currency: payment.currency ?? undefined,
    cardLast4: payment.card_last4 ?? null,
    membershipId: payment.membership?.id ?? null,
    planId: payment.plan?.id ?? null,
    customerEmail: typeof payment.metadata?.customer_email === "string" ? payment.metadata.customer_email : null,
    whopPaymentId: payment.id,
  };

  const reference = typeof payment.metadata?.reference === "string" ? payment.metadata.reference : "";
  const granted = await grantIntent(reference, options);
  if (granted !== null) return granted;

  // No intent — Whop billed the plan automatically; grant from the live
  // subscription instead.
  return grantSubscriptionCharge(payment.id, options);
}

// POST /whop/checkout — resolve the plan, mint an intent, and open a hosted
// Whop checkout. Returns the purchase_url the client should redirect to. No
// card data is ever accepted here.
router.post("/whop/checkout", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!whopApiKey() || !whopAccountId()) {
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

  // Every Whop subscription auto-renews by default: Whop keeps the card and
  // re-charges it each cycle through the membership. Only an admin can turn
  // it off — per plan (a nexet_subscription_plan_settings row with
  // autoRenewAvailable false turns it off here) or per subscription (the
  // admin toggle). Any client-sent autoRenew flag is ignored.
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
  // Whop renewal plans charge the full monthly plan amount — a percentage or
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

  // Mirror the catalog plan as a Whop renewal plan (once) and subscribe the
  // customer to it — Whop then charges the plan amount every 30 days.
  const whopPlanId = await getOrCreatePlan(kind, planId, total, product.planLabel);

  // Whop checkout can use the customer email from Clerk metadata.
  let email: string | null = null;
  try {
    const user = await clerkClient.users.getUser(userId);
    email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? null;
  } catch (cause) {
    logger.warn({ userId }, "whop checkout: failed to resolve clerk user");
  }

  const reference = `whp_${randomUUID()}`;
  const callbackUrl = validCallbackUrl(body.callbackUrl) ?? defaultCallbackUrl();

  await db.insert(nexetWhopIntentsTable).values({
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
    const { purchaseUrl } = await createCheckout({
      planId: whopPlanId,
      redirectUrl: callbackUrl,
      metadata: {
        reference,
        customer_email: email ?? "",
        userId,
        kind,
        planId,
        ...(promo?.code ? { promoCode: promo.code } : {}),
      },
    });
    res.status(201).json({ granted: false, checkoutUrl: purchaseUrl, reference });
  } catch (cause) {
    // Roll the intent back so nothing lingers as PENDING.
    await db.delete(nexetWhopIntentsTable).where(eq(nexetWhopIntentsTable.reference, reference)).catch(() => {});
    const message = cause instanceof WhopApiError ? cause.message : "Whop could not open the checkout session";
    res.status(502).json({ error: message });
  }
});

// POST /whop/webhook — Whop pushes payment.* and membership.* lifecycle events
// here. Signature-verified with the Standard Webhooks spec over the RAW body
// (captured by the express.json verify hook in app.ts). Always answers 200
// once handled.
router.post("/whop/webhook", async (req: Request, res: Response): Promise<void> => {
  const rawBody = String((req as Request & { rawBody?: Buffer }).rawBody ?? "");
  const headers = req.headers as Record<string, string | string[] | undefined>;
  if (!whopSignatureValid(rawBody, {
    "webhook-id": headers["webhook-id"],
    "webhook-timestamp": headers["webhook-timestamp"],
    "webhook-signature": headers["webhook-signature"],
  })) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const payload = (req.body ?? {}) as {
    type?: string;
    data?: Record<string, unknown>;
  };
  const type = payload.type ?? "";
  const data = payload.data ?? {};

  try {
    if (type === "payment.succeeded") {
      const result = await handlePaymentSucceeded(data as unknown as WhopPayment);
      if (result === null) logger.warn({ paymentId: data.id }, "whop webhook: unknown payment (ignored)");
    } else if (type === "payment.failed") {
      // A charge was declined — surface it on the intent (first purchase) or
      // the live subscription (renewal).
      const metadata = (data.metadata ?? {}) as { reference?: unknown };
      const reference = typeof metadata.reference === "string" ? metadata.reference : "";
      const membershipId = (data.membership as { id?: string } | null)?.id ?? null;
      if (reference) {
        const intent = await lookupIntent(reference);
        if (intent && intent.status === "PENDING") await markIntent(reference, "FAILED");
      } else if (membershipId) {
        await db
          .update(nexetSubscriptionsTable)
          .set({
            renewalFailure:
              "The monthly charge was declined — update the card on your subscription or contact support.",
            updatedAt: new Date(),
          })
          .where(and(eq(nexetSubscriptionsTable.whopMembershipId, membershipId), eq(nexetSubscriptionsTable.autoRenew, true)));
      }
    } else if (type === "membership.deactivated") {
      // Cancelled or completed — stop treating the chain as auto-renewing.
      const membershipId = (data as { id?: string }).id;
      if (membershipId) {
        await db
          .update(nexetSubscriptionsTable)
          .set({ autoRenew: false, updatedAt: new Date() })
          .where(eq(nexetSubscriptionsTable.whopMembershipId, membershipId));
      }
    }
    res.status(200).json({ received: true });
  } catch (cause) {
    logger.error({ type, err: cause }, "whop webhook: grant failed");
    res.status(500).json({ error: "Grant failed" });
  }
});

// POST /whop/confirm — called from the app's return page after Whop redirects
// the customer back. The intent flips to SUCCESS via the payment.succeeded
// webhook; this route re-checks it server-side (idempotent with the webhook).
// Only the user who owns the intent may confirm it.
router.post("/whop/confirm", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!reference) {
    res.status(400).json({ error: "A checkout reference is required" });
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

  if (intent.status === "SUCCESS") {
    res.status(200).json({
      granted: true,
      receipt: {
        total: intent.amountUsd,
        cardLast4: intent.cardLast4 ?? null,
        promoCode: intent.promoCode,
      },
    });
    return;
  }

  if (intent.status === "FAILED") {
    res.status(200).json({
      granted: false,
      status: "failed",
      error: "The payment did not complete. Try again if you were not charged.",
    });
    return;
  }

  // Still PENDING — the webhook may not have landed yet. Ask the customer to
  // check back; the webhook will grant the entitlement as soon as it arrives.
  res.status(200).json({
    granted: false,
    status: "pending",
    error: "Your payment is still being confirmed — check back in a minute, it will appear automatically if it went through.",
  });
});

export default router;