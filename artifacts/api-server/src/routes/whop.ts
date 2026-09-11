import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
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
  restoreSubscriptionEntitlement,
  revokeSubscriptionEntitlement,
  unknownProductMessage,
  type EntitlementChange,
  type SubscriptionEntitlementRef,
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
  fetchPaymentById,
  findPaymentByReference,
  listPaymentsSince,
  whopPaymentFullyRefunded,
  whopPaymentHasOpenDispute,
  whopPaymentRefunded,
  whopPaymentSucceeded,
  whopPaymentTotal,
  whopSignatureValid,
  withKnownEmail,
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

/**
 * Whop has no notion of our reference on the redirect — it only bounces the
 * browser to redirect_url. Every return gate (the subscriptions page, the
 * ticket gate, and the Author/Creator Den WhopReturnGates) confirms the charge
 * by reading `?reference=` off the URL they land on, so we have to put the
 * parameter there ourselves or the confirm-on-return never fires. Any query the
 * client already had (e.g. ?tab=storage) is preserved.
 */
function withReference(callbackUrl: string, reference: string): string {
  try {
    const url = new URL(callbackUrl);
    url.searchParams.set("reference", reference);
    return url.toString();
  } catch {
    return callbackUrl;
  }
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
    .select({ whopPlanId: nexetWhopPlansTable.whopPlanId, amountUsd: nexetWhopPlansTable.amountUsd })
    .from(nexetWhopPlansTable)
    .where(and(eq(nexetWhopPlansTable.kind, kind), eq(nexetWhopPlansTable.planId, planId)))
    .limit(1);
  // The cached plan is only reusable while the catalog price still matches it.
  // After a repricing, reusing it would leave Whop billing the OLD amount while
  // every grant compares against the NEW one — so the charge would mismatch and
  // be refused for both new purchases and renewals on this plan.
  if (existing && existing.amountUsd === amountUsd) return existing.whopPlanId;

  const { whopPlanId } = await createPlan({
    title: `${planLabel} (Monthly)`,
    amountCents: amountUsd,
    billingPeriodDays: WHOP_BILLING_PERIOD_DAYS,
  });
  await db
    .insert(nexetWhopPlansTable)
    .values({ kind, planId, whopPlanId, amountUsd, billingPeriodDays: WHOP_BILLING_PERIOD_DAYS })
    // Replace a repriced row rather than leaving the stale plan id behind.
    .onConflictDoUpdate({
      target: [nexetWhopPlansTable.kind, nexetWhopPlansTable.planId],
      set: {
        whopPlanId,
        amountUsd,
        billingPeriodDays: WHOP_BILLING_PERIOD_DAYS,
        updatedAt: new Date(),
      },
    });
  if (existing) {
    logger.warn(
      { kind, planId, wasAmountUsd: existing.amountUsd, amountUsd },
      "whop: catalog price changed — mirrored a new Whop plan",
    );
  }
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
    // Error level on purpose: a mismatch means money moved but we refused to
    // grant, which needs a human to look at the Whop dashboard. Nothing here
    // auto-refunds or re-grants.
    logger.error(
      { reference, expected: intent.amountUsd, paid: options.amountCents, currency: options.currency },
      "whop amount/currency mismatch — intent marked FAILED (review in Whop; the customer may have been charged)",
    );
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
  // Matched on the membership alone, NOT on our auto-renew flag. Whop has
  // already taken the money; refusing to grant because a local flag drifted
  // would charge the customer and hand them nothing. A drifted flag is logged
  // loudly instead of silently swallowing the purchase.
  const [sub] = await db
    .select()
    .from(nexetSubscriptionsTable)
    .where(eq(nexetSubscriptionsTable.whopMembershipId, options.membershipId))
    .orderBy(desc(nexetSubscriptionsTable.createdAt))
    .limit(1);
  if (!sub) return null;
  if (sub.autoRenew !== true) {
    logger.warn(
      { membershipId: options.membershipId, subscriptionId: sub.id },
      "whop recurring charge on a subscription we believed was not auto-renewing — granting anyway",
    );
  }

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

/** The Whop payment (pay_…) a refund or dispute event refers to, if stated. */
function paymentIdFromEvent(data: Record<string, unknown>): string | null {
  const direct = data.payment_id;
  if (typeof direct === "string" && direct) return direct;
  const payment = data.payment as { id?: unknown } | null | undefined;
  if (payment && typeof payment.id === "string" && payment.id) return payment.id;
  return null;
}

/**
 * Ask Whop directly whether the checkout behind a PENDING intent was paid, and
 * grant from the live payment if it was.
 *
 * This exists because the webhook cannot be the only way a paying customer gets
 * their purchase: if a payment.succeeded delivery is ever missed, the customer
 * has been charged and nothing would ever notice. Both the post-redirect
 * /whop/confirm and the periodic reconcile sweep go through here.
 *
 *  - "granted"  — the entitlement is applied (or already was)
 *  - "failed"   — Whop says the charge did not settle
 *  - "mismatch" — a payment exists but its amount/currency doesn't match
 *  - "pending"  — no payment yet (or Whop unreachable); try again later
 *
 * Never throws: a Whop outage leaves the intent PENDING so the webhook or a
 * later sweep can still complete it.
 */
async function verifyIntentWithWhop(
  reference: string,
): Promise<"granted" | "failed" | "mismatch" | "pending"> {
  const intent = await lookupIntent(reference);
  if (!intent) return "pending";
  if (intent.status === "SUCCESS") return "granted";
  if (intent.status === "FAILED") return "failed";
  if (!whopApiKey()) return "pending";

  let payment: WhopPayment | null = null;
  try {
    payment = await findPaymentByReference(reference, intent.createdAt);
  } catch (cause) {
    logger.warn({ err: cause, reference }, "whop verify: could not reach Whop");
    return "pending";
  }
  if (!payment) return "pending";

  if (!whopPaymentSucceeded(payment)) {
    // Whop knows the charge and it is definitively dead — never grant, and stop
    // waiting on a webhook for it.
    if (payment.status === "void" || payment.status === "uncollectible" || payment.status === "unresolved") {
      await markIntent(reference, "FAILED");
      return "failed";
    }
    return "pending";
  }

  try {
    const result = await handlePaymentSucceeded(payment);
    if (result === "granted" || result === "already") return "granted";
    if (result === "mismatch") return "mismatch";
    return "pending";
  } catch (cause) {
    // handlePaymentSucceeded reset the intent to PENDING before rethrowing, so
    // the webhook or the next sweep can retry.
    logger.error({ err: cause, reference }, "whop verify: grant failed, left PENDING for retry");
    return "pending";
  }
}

/** Let the webhook have a go before we start polling Whop for an intent. */
const RECONCILE_MIN_AGE_MS = 2 * 60 * 1000;
/** Past this, an unpaid intent is an abandoned checkout, not a pending charge. */
const RECONCILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Sweep PENDING intents that no webhook resolved and settle them against Whop.
 * Runs on a timer (whop/reconcile-runner.ts). Anything older than the max age
 * with no payment behind it is an abandoned checkout, so it is marked FAILED
 * rather than queried forever.
 */
export async function reconcileWhopIntents(): Promise<{
  checked: number;
  granted: number;
  failed: number;
}> {
  if (!whopApiKey()) return { checked: 0, granted: 0, failed: 0 };

  const rows = await db
    .select()
    .from(nexetWhopIntentsTable)
    .where(eq(nexetWhopIntentsTable.status, "PENDING"))
    .orderBy(desc(nexetWhopIntentsTable.createdAt))
    .limit(50);

  const now = Date.now();
  let checked = 0;
  let granted = 0;
  let failed = 0;

  for (const row of rows) {
    const age = now - row.createdAt.getTime();
    if (age < RECONCILE_MIN_AGE_MS) continue;
    checked += 1;

    const outcome = await verifyIntentWithWhop(row.reference);
    if (outcome === "granted") {
      granted += 1;
      logger.info({ reference: row.reference, userId: row.userId }, "whop reconcile: granted a purchase the webhook missed");
    } else if (outcome === "failed") {
      failed += 1;
    } else if (outcome === "pending" && age > RECONCILE_MAX_AGE_MS) {
      await markIntent(row.reference, "FAILED");
      failed += 1;
    }
  }

  return { checked, granted, failed };
}

/**
 * Re-derive a subscription's state from the live Whop payment behind it.
 *
 * Refunds and disputes are not one-way, so the webhook event is only a trigger
 * and Whop's payment record is the evidence:
 *  - fully refunded, or a dispute still in play → REFUNDED, auto-renew off
 *  - partially refunded → left active and flagged, because the customer kept
 *    what they paid for
 *  - settled and clear again (e.g. a dispute we won) → ACTIVE, flag cleared
 *
 * `eventType` decides what to do when Whop cannot be re-read: a `.created`
 * event revokes (the safe direction for a reversal we cannot verify), an
 * `.updated` one leaves the row alone rather than reinstating access blindly.
 */
/** The subscription columns a refund decision needs. */
type RefundableSubscription = {
  id: string;
  status: string;
  userId: string;
  kind: string;
  planId: string;
  periodEnd: Date;
  priceUsd: number;
  promoCode: string | null;
  cardLast4: string | null;
};

function entitlementRefFor(row: RefundableSubscription): SubscriptionEntitlementRef {
  return {
    userId: row.userId,
    kind: row.kind as SubscriptionKind,
    planId: row.planId,
    periodEnd: row.periodEnd,
    priceUsd: row.priceUsd,
    promoCode: row.promoCode,
    cardLast4: row.cardLast4,
  };
}

/**
 * Cut a refunded customer's access the moment the reversal arrives: remove the
 * entitlement the purchase granted (pass ticket, or the storage/project credits
 * it added) and mark the row REFUNDED — in one transaction, so access can never
 * be cut without the record saying so, or the record say so while the access
 * still stands.
 *
 * The `status <> 'REFUNDED'` update is the atomic claim: a redelivered or
 * concurrent webhook cannot take the same credits back twice, and if the
 * revocation throws, the rollback leaves the row ACTIVE so Whop's retry (the
 * 500 we return) runs the whole thing again cleanly.
 */
async function revokeAccessForRefund(
  row: RefundableSubscription,
  message: string,
): Promise<EntitlementChange | null> {
  const change = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(nexetSubscriptionsTable)
      .set({ status: "REFUNDED", autoRenew: false, renewalFailure: message, updatedAt: new Date() })
      .where(
        and(eq(nexetSubscriptionsTable.id, row.id), ne(nexetSubscriptionsTable.status, "REFUNDED")),
      )
      .returning({ id: nexetSubscriptionsTable.id });
    if (!claimed) return null; // already refunded — its access went with it
    return revokeSubscriptionEntitlement(entitlementRefFor(row), tx);
  });
  if (!change) return null;

  for (const warning of change.warnings) {
    logger.error({ subscriptionId: row.id, userId: row.userId }, warning);
  }
  logger.info(
    {
      subscriptionId: row.id,
      userId: row.userId,
      kind: row.kind,
      planId: row.planId,
      ticketRemoved: change.ticketChanged,
      storageBytesRemoved: change.storageBytes,
      projectSlotsRemoved: change.projectSlots,
    },
    "whop refund/dispute: access revoked immediately",
  );
  return change;
}

async function refreshSubscriptionForPayment(
  paymentId: string,
  eventType: string,
): Promise<void> {
  const isDispute = eventType.startsWith("dispute");
  const revokedMessage = isDispute
    ? "A payment dispute was opened for this purchase — the plan is no longer active."
    : "This purchase was refunded — the plan is no longer active.";
  const [row] = await db
    .select({
      id: nexetSubscriptionsTable.id,
      status: nexetSubscriptionsTable.status,
      userId: nexetSubscriptionsTable.userId,
      kind: nexetSubscriptionsTable.kind,
      planId: nexetSubscriptionsTable.planId,
      periodEnd: nexetSubscriptionsTable.periodEnd,
      priceUsd: nexetSubscriptionsTable.priceUsd,
      promoCode: nexetSubscriptionsTable.promoCode,
      cardLast4: nexetSubscriptionsTable.cardLast4,
    })
    .from(nexetSubscriptionsTable)
    .where(eq(nexetSubscriptionsTable.whopPaymentId, paymentId))
    .limit(1);
  if (!row) {
    logger.error(
      { paymentId },
      "whop refund/dispute: no subscription holds this payment id — needs manual review",
    );
    return;
  }

  let payment: WhopPayment | null = null;
  try {
    payment = await fetchPaymentById(paymentId);
  } catch (cause) {
    logger.warn({ err: cause, paymentId }, "whop refund/dispute: could not re-read the payment");
  }

  if (!payment) {
    // Whop could not be re-read. A `.created` event is still a reversal we
    // have to act on, so revoke on the event alone — the safe direction.
    if (eventType.endsWith(".created")) {
      await revokeAccessForRefund(row, revokedMessage);
    }
    return;
  }

  const disputeStatuses = (payment.disputes ?? []).map((dispute) => dispute?.status ?? "unknown");
  if (disputeStatuses.length > 0) {
    // Logged so the open-status set in lib/whop.ts can be corrected if Whop
    // introduces a state we do not recognise.
    logger.info({ paymentId, disputeStatuses }, "whop refund/dispute: dispute statuses observed");
  }

  const openDispute = whopPaymentHasOpenDispute(payment);
  const refunded = whopPaymentRefunded(payment);

  if (openDispute || whopPaymentFullyRefunded(payment)) {
    await revokeAccessForRefund(
      row,
      openDispute ? revokedMessage : "This purchase was refunded — the plan is no longer active.",
    );
    return;
  }

  if (refunded) {
    // Partial: the plan stays live, but a human should decide what happens next.
    logger.error(
      {
        paymentId,
        subscriptionId: row.id,
        refundedAmount: payment.refunded_amount,
        total: whopPaymentTotal(payment),
      },
      "whop refund: partial refund — subscription left active, needs manual review",
    );
    return;
  }

  if (row.status === "REFUNDED") {
    // Access was cut when the reversal arrived, so winning the dispute has to
    // give it back — same claim-then-act shape as the revoke, so a repeated
    // `.updated` event cannot add the credits twice.
    const change = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(nexetSubscriptionsTable)
        .set({ status: "ACTIVE", renewalFailure: null, updatedAt: new Date() })
        .where(
          and(
            eq(nexetSubscriptionsTable.id, row.id),
            eq(nexetSubscriptionsTable.status, "REFUNDED"),
          ),
        )
        .returning({ id: nexetSubscriptionsTable.id });
      if (!claimed) return null; // a concurrent event already restored it
      return restoreSubscriptionEntitlement(entitlementRefFor(row), tx);
    });
    if (!change) return;

    for (const warning of change.warnings) {
      logger.error({ subscriptionId: row.id, userId: row.userId }, warning);
    }
    // Auto-renew is deliberately left off: access is restored, billing is not.
    logger.info(
      {
        paymentId,
        subscriptionId: row.id,
        ticketRestored: change.ticketChanged,
        storageBytesRestored: change.storageBytes,
        projectSlotsRestored: change.projectSlots,
      },
      "whop refund/dispute: charge cleared — access restored",
    );
  }
}

/** How far back the payment sweep re-checks. */
const RECONCILE_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Re-check every recent Whop payment against our records.
 *
 * `handlePaymentSucceeded` is idempotent per payment id (it early-returns when
 * a subscription already stores that `pay_…`), so this is safe to repeat and it
 * picks up *any* settled charge we never recorded — a missed first payment, or a
 * renewal our auto-renew flag did not match. Charges that still match nothing
 * are reported at error level: that line is the dead-letter record and it
 * repeats until someone resolves it.
 */
export async function reconcileRecentPayments(): Promise<{
  seen: number;
  recovered: number;
  unmatched: number;
}> {
  if (!whopApiKey()) return { seen: 0, recovered: 0, unmatched: 0 };

  const payments = await listPaymentsSince(new Date(Date.now() - RECONCILE_PAYMENT_WINDOW_MS));
  let recovered = 0;
  const unmatched: string[] = [];

  for (const payment of payments) {
    if (!whopPaymentSucceeded(payment)) continue;
    const result = await handlePaymentSucceeded(payment);
    if (result === "granted") {
      recovered += 1;
      logger.error(
        { paymentId: payment.id },
        "whop reconcile: recovered a settled payment that was never recorded — investigate why it was missed",
      );
    } else if (result === null) {
      unmatched.push(payment.id);
    }
  }

  if (unmatched.length > 0) {
    logger.error(
      { paymentIds: unmatched },
      "whop reconcile: settled payment(s) matched no intent or subscription — manual review required",
    );
  }

  return { seen: payments.length, recovered, unmatched: unmatched.length };
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
  // customer to it — Whop then charges the plan amount every 30 days. Whop
  // answers 400 here when the product/account pairing is wrong (a bad
  // WHOP_PRODUCT_ID, or a product type that cannot carry a renewal plan), so
  // surface its reason as a 502 like createCheckout below does, instead of
  // letting the WhopApiError escape as an unhandled error. Nothing to roll
  // back yet — the intent row is written after this.
  let whopPlanId: string;
  try {
    whopPlanId = await getOrCreatePlan(kind, planId, total, product.planLabel);
  } catch (cause) {
    logger.error({ err: cause, kind, planId }, "whop checkout: failed to create the mirror plan");
    res.status(502).json({
      error:
        cause instanceof WhopApiError ? cause.message : "Whop could not create the subscription plan",
    });
    return;
  }

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
      redirectUrl: withReference(callbackUrl, reference),
      metadata: {
        reference,
        customer_email: email ?? "",
        userId,
        kind,
        planId,
        ...(promo?.code ? { promoCode: promo.code } : {}),
      },
    });
    // We already know the customer's address from Clerk, so hide Whop's email
    // input instead of asking for it a second time.
    res.status(201).json({ granted: false, checkoutUrl: withKnownEmail(purchaseUrl, email), reference });
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
    } else if (type === "membership.cancel_at_period_end_changed") {
      // Whop is the source of truth for renewals — our admin toggle is one
      // writer and the customer's own billing page is another — so mirror the
      // flag instead of trusting our local copy to stay in step.
      const membershipId = (data as { id?: string }).id;
      const cancelAtPeriodEnd = (data as { cancel_at_period_end?: unknown }).cancel_at_period_end;
      if (membershipId && typeof cancelAtPeriodEnd === "boolean") {
        await db
          .update(nexetSubscriptionsTable)
          .set({ autoRenew: !cancelAtPeriodEnd, updatedAt: new Date() })
          .where(eq(nexetSubscriptionsTable.whopMembershipId, membershipId));
      }
    } else if (
      type === "refund.created" ||
      type === "refund.updated" ||
      type === "dispute.created" ||
      type === "dispute.updated"
    ) {
      // A reversal is not necessarily one-way: a dispute can be won, and a
      // partial refund is not a reversal of the purchase at all. So the event
      // is only a trigger — re-read the payment and let Whop's record decide.
      const paymentId = paymentIdFromEvent(data);
      if (!paymentId) {
        logger.error(
          { type, data },
          "whop webhook: refund/dispute with no payment id — needs manual review",
        );
      } else {
        // A `.created` event revokes even if Whop cannot be re-read; the
        // `.updated` ones only ever restore, and only from live evidence.
        await refreshSubscriptionForPayment(paymentId, type);
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

  // Still PENDING. The webhook may not have landed — or may never land — so
  // verify against Whop ourselves and grant from the live payment. Without this
  // the purchase would hang on a single webhook delivery.
  const verified = await verifyIntentWithWhop(reference);
  if (verified === "granted") {
    const settled = await lookupIntent(reference);
    res.status(200).json({
      granted: true,
      receipt: {
        total: settled?.amountUsd ?? intent.amountUsd,
        cardLast4: settled?.cardLast4 ?? null,
        promoCode: settled?.promoCode ?? intent.promoCode,
      },
    });
    return;
  }
  if (verified === "failed" || verified === "mismatch") {
    res.status(200).json({
      granted: false,
      status: "failed",
      error: "The payment did not complete. Try again if you were not charged.",
    });
    return;
  }

  res.status(200).json({
    granted: false,
    status: "pending",
    error: "Your payment is still being confirmed — check back in a minute, it will appear automatically if it went through.",
  });
});

export default router;