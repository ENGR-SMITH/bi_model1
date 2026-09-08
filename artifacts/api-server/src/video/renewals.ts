import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import {
  db,
  tandemPaystackIntentsTable,
  tandemSubscriptionsTable,
} from "@workspace/db";
import { PASS_PRICE_USD } from "../routes/tickets";
import { PROJECT_PLANS, STORAGE_PLANS } from "./quota";
import type { SubscriptionKind } from "./subscriptions";
import { chargeAuthorization, paystackSecretKey } from "../lib/paystack";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Server-managed auto-renewal — every subscription kind (category passes,
// workspace storage, project plans). A purchase made through Paystack keeps
// its card authorization on the subscription row and auto-renews by default;
// this runner wakes on an interval and, for every active auto-renewing
// subscription whose period is close to ending (and no renewal charge already
// in flight), mints a fresh intent and re-charges the saved card at the plan's
// own price. The ordinary charge.success webhook then grants the extension
// through the same grantIntent path as a fresh purchase, so renewals and new
// purchases can never behave differently.
// ---------------------------------------------------------------------------

/** Start charging when this close to the subscription expiring (2 days ahead). */
export const RENEW_LEAD_MS = 2 * 24 * 60 * 60 * 1000;
/** Still charge if a cycle is a little late (12h grace) — never after the
    entitlement is long gone. */
export const RENEW_GRACE_MS = 12 * 60 * 60 * 1000;

export interface RenewalCycleResult {
  charged: number;
  failed: number;
}

function failureMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message.slice(0, 300);
  return "The automatic renewal charge was declined. Contact support to keep your subscription renewing.";
}

/**
 * The price to re-charge for a subscription's plan, in USD cents. Passes use
 * the fixed pass price; storage and project plans charge their catalog price.
 * Null when the plan id is unknown (shouldn't happen — the row came from a
 * real checkout).
 */
function renewalAmountUsd(kind: SubscriptionKind, planId: string): number | null {
  if (kind === "pass") return PASS_PRICE_USD;
  if (kind === "storage") return STORAGE_PLANS.find((plan) => plan.id === planId)?.priceUsd ?? null;
  if (kind === "projects") return PROJECT_PLANS.find((plan) => plan.id === planId)?.priceUsd ?? null;
  return null;
}

/**
 * One renewal pass over the subscriptions table. Exported for tests; the
 * interval runner calls it and logs the outcome.
 */
export async function runSubscriptionRenewals(now: Date = new Date()): Promise<RenewalCycleResult> {
  if (!paystackSecretKey()) return { charged: 0, failed: 0 };

  const windowStart = new Date(now.getTime() - RENEW_GRACE_MS);
  const windowEnd = new Date(now.getTime() + RENEW_LEAD_MS);

  const due = await db
    .select()
    .from(tandemSubscriptionsTable)
    .where(
      and(
        eq(tandemSubscriptionsTable.autoRenew, true),
        eq(tandemSubscriptionsTable.status, "ACTIVE"),
        gt(tandemSubscriptionsTable.periodEnd, windowStart),
        lt(tandemSubscriptionsTable.periodEnd, windowEnd),
      ),
    )
    .orderBy(asc(tandemSubscriptionsTable.periodEnd));

  let charged = 0;
  let failed = 0;

  for (const sub of due) {
    // One charge in flight per subscription row — if a cycle already minted a
    // PENDING intent for this renewal, wait for its webhook instead of
    // double-charging the card.
    const [open] = await db
      .select({ reference: tandemPaystackIntentsTable.reference })
      .from(tandemPaystackIntentsTable)
      .where(
        and(
          eq(tandemPaystackIntentsTable.renewalFor, sub.id),
          eq(tandemPaystackIntentsTable.status, "PENDING"),
        ),
      )
      .limit(1);
    if (open) continue;

    // No card on file — we cannot renew; stop the chain and tell the user.
    if (!sub.paystackEmail || !sub.paystackAuthorizationCode) {
      await db
        .update(tandemSubscriptionsTable)
        .set({
          autoRenew: false,
          renewalFailure:
            "No card is on file for this subscription — contact support or resubscribe to keep it renewing.",
        })
        .where(eq(tandemSubscriptionsTable.id, sub.id));
      failed += 1;
      continue;
    }

    // The plan's own price — a renewal re-charges exactly what the purchase
    // charged. Unknown plan id (shouldn't happen): stop the chain.
    const amountUsd = renewalAmountUsd(sub.kind as SubscriptionKind, sub.planId);
    if (amountUsd === null) {
      await db
        .update(tandemSubscriptionsTable)
        .set({
          autoRenew: false,
          renewalFailure: "This plan can no longer be renewed — contact support.",
        })
        .where(eq(tandemSubscriptionsTable.id, sub.id));
      failed += 1;
      continue;
    }

    const reference = `tan_${randomUUID()}`;
    await db.insert(tandemPaystackIntentsTable).values({
      reference,
      userId: sub.userId,
      kind: sub.kind,
      planId: sub.planId,
      planLabel: sub.planLabel,
      intervalLabel: sub.intervalLabel,
      amountUsd,
      currency: "USD",
      status: "PENDING",
      autoRenew: true,
      renewalFor: sub.id,
      customerEmail: sub.paystackEmail,
    });

    try {
      await chargeAuthorization({
        email: sub.paystackEmail,
        amount: amountUsd,
        authorizationCode: sub.paystackAuthorizationCode,
        reference,
        metadata: { userId: sub.userId, subscriptionId: sub.id, renewal: true },
      });
      charged += 1;
    } catch (cause) {
      // Synchronous decline/expired authorization — record it and stop the
      // chain so the runner never retries a card that is not working.
      await db
        .update(tandemPaystackIntentsTable)
        .set({ status: "FAILED", updatedAt: new Date() })
        .where(eq(tandemPaystackIntentsTable.reference, reference));
      await db
        .update(tandemSubscriptionsTable)
        .set({ autoRenew: false, renewalFailure: failureMessage(cause), updatedAt: new Date() })
        .where(eq(tandemSubscriptionsTable.id, sub.id));
      logger.warn({ subscriptionId: sub.id, userId: sub.userId }, "auto-renew charge failed synchronously");
      failed += 1;
    }
  }

  return { charged, failed };
}

/**
 * Kick off the renewal runner for the life of the process. Only meaningful
 * when Paystack is configured; a no-op otherwise.
 */
export function startSubscriptionRenewalRunner(): void {
  if (!paystackSecretKey()) {
    logger.info("Paystack not configured — subscription auto-renewal runner disabled");
    return;
  }
  const run = async (): Promise<void> => {
    try {
      const result = await runSubscriptionRenewals();
      if (result.charged > 0 || result.failed > 0) {
        logger.info(result, "subscription renewal cycle finished");
      }
    } catch (cause) {
      logger.error({ err: cause }, "subscription renewal cycle failed");
    }
  };
  // Every hour, shortly after the minute, plus one pass on boot.
  const tickMs = 60 * 60 * 1000;
  void run();
  const timer = setInterval(() => {
    void run();
  }, tickMs);
  timer.unref?.();
}
