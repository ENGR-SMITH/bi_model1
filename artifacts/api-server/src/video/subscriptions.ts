import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  tandemAccountQuotasTable,
  tandemPromoCodesTable,
  tandemPromoRedemptionsTable,
  tandemSubscriptionPlanSettingsTable,
  tandemSubscriptionsTable,
  tandemTicketsTable,
} from "@workspace/db";
import { STORAGE_PLANS, PROJECT_PLANS, getOrCreateQuota } from "./quota";
import { PASS_PRICE_USD, TICKET_CATEGORIES, type TicketCategory } from "../routes/tickets";

// ---------------------------------------------------------------------------
// Subscriptions — a unified view of the three purchase products across the
// apps: TANDEM category passes, Creator Den workspace storage, and Author Den
// projects. This module owns the plan catalog and the record of every
// subscription a user has made, so any surface (the TANDEM Subscriptions page
// or the in-app checkout modals) can read it back with type / status / expiry
// and usage.
// ---------------------------------------------------------------------------

export type SubscriptionKind = "pass" | "storage" | "projects";

/** One subscription period — a month. Every plan bills monthly via Paystack. */
export const SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
/** The billing rhythm every plan shares. */
export const SUBSCRIPTION_INTERVAL_LABEL = "1 month";

/** One purchasable subscription product shown on the payments page. */
export interface SubscriptionPlan {
  kind: SubscriptionKind;
  planId: string;
  planLabel: string;
  priceUsd: number;
  intervalLabel: string;
  detail: string;
  /** Whether purchases of this plan auto-renew by default (on for every plan
      unless an admin switches it off). */
  autoRenewAvailable: boolean;
}

/** Whether a plan kind allows auto-renewal when no admin override exists. */
function defaultAutoRenewAvailable(_kind: SubscriptionKind): boolean {
  // Every Paystack subscription auto-renews by default — passes, storage, and
  // project plans alike. Only an admin can turn it off, either here (per
  // plan) or on an individual subscription row.
  return true;
}

/**
 * Resolve whether customers may turn on server-managed auto-renewal for one
 * plan: a row in tandem_subscription_plan_settings (written by an admin) wins,
 * otherwise the code-defined default (on for every plan kind).
 */
export async function autoRenewAvailableForPlan(kind: SubscriptionKind, planId: string): Promise<boolean> {
  const [setting] = await db
    .select({ autoRenewAvailable: tandemSubscriptionPlanSettingsTable.autoRenewAvailable })
    .from(tandemSubscriptionPlanSettingsTable)
    .where(
      and(
        eq(tandemSubscriptionPlanSettingsTable.kind, kind),
        eq(tandemSubscriptionPlanSettingsTable.planId, planId),
      ),
    )
    .limit(1);
  return setting ? setting.autoRenewAvailable : defaultAutoRenewAvailable(kind);
}

export async function subscriptionPlans(): Promise<SubscriptionPlan[]> {
  const overrides = await db.select().from(tandemSubscriptionPlanSettingsTable);
  const availableFor = (kind: SubscriptionKind, planId: string): boolean => {
    const row = overrides.find((setting) => setting.kind === kind && setting.planId === planId);
    return row ? row.autoRenewAvailable : defaultAutoRenewAvailable(kind);
  };

  // Every plan bills monthly through a Paystack subscription plan — the pass
  // and the storage/project extensions all share the same one-month rhythm.
  const passes: SubscriptionPlan[] = TICKET_CATEGORIES.map((category) => ({
    kind: "pass",
    planId: category,
    planLabel: category === "authors" ? "Author & Writer pass" : "Content Creators pass",
    priceUsd: PASS_PRICE_USD,
    intervalLabel: SUBSCRIPTION_INTERVAL_LABEL,
    detail: `A ticket into the ${category === "authors" ? "Author&pos;s Atrium" : "Content Creators room"} for ${SUBSCRIPTION_INTERVAL_LABEL}`,
    autoRenewAvailable: availableFor("pass", category),
  }));

  const storage: SubscriptionPlan[] = STORAGE_PLANS.map((plan) => ({
    kind: "storage",
    planId: plan.id,
    planLabel: plan.label,
    priceUsd: plan.priceUsd,
    intervalLabel: SUBSCRIPTION_INTERVAL_LABEL,
    detail: `Extend your workspace storage with another ${plan.label}`,
    autoRenewAvailable: availableFor("storage", plan.id),
  }));

  const projects: SubscriptionPlan[] = PROJECT_PLANS.map((plan) => ({
    kind: "projects",
    planId: plan.id,
    planLabel: `+${plan.count} projects`,
    priceUsd: plan.priceUsd,
    intervalLabel: SUBSCRIPTION_INTERVAL_LABEL,
    detail: plan.label,
    autoRenewAvailable: availableFor("projects", plan.id),
  }));

  return [...passes, ...storage, ...projects];
}

/** Bytes added for a storage plan id, or 0. */
export function storagePlanBytes(planId: string): number {
  return STORAGE_PLANS.find((plan) => plan.id === planId)?.bytes ?? 0;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(0)} TB`;
  return `${(bytes / 1024 ** 3).toFixed(0)} GB`;
}

/**
 * Resolve a purchasable product (kind + planId) to its catalog fields, or
 * null when the kind/plan combination is unknown. Shared by the card checkout
 * and the Paystack checkout so a plan always prices the same everywhere.
 */
export function resolveSubscriptionProduct(
  kind: SubscriptionKind,
  planId: string,
): { priceUsd: number; planLabel: string; intervalLabel: string } | null {
  if (kind === "pass") {
    if (!isPassCategory(planId)) return null;
    return {
      priceUsd: PASS_PRICE_USD,
      planLabel: planId === "authors" ? "Author & Writer pass" : "Content Creators pass",
      intervalLabel: SUBSCRIPTION_INTERVAL_LABEL,
    };
  }
  if (kind === "storage") {
    const plan = STORAGE_PLANS.find((item) => item.id === planId);
    if (!plan) return null;
    return {
      priceUsd: plan.priceUsd,
      planLabel: `${formatBytes(plan.bytes)} more space`,
      intervalLabel: SUBSCRIPTION_INTERVAL_LABEL,
    };
  }
  const plan = PROJECT_PLANS.find((item) => item.id === planId);
  if (!plan) return null;
  return {
    priceUsd: plan.priceUsd,
    planLabel: `+${plan.count} projects`,
    intervalLabel: SUBSCRIPTION_INTERVAL_LABEL,
  };
}

/** Projects added for a project plan id, or 0. */
export function projectPlanCount(planId: string): number {
  return PROJECT_PLANS.find((plan) => plan.id === planId)?.count ?? 0;
}

/** Whether a category is a valid pass category. */
export function isPassCategory(value: string): value is TicketCategory {
  return (TICKET_CATEGORIES as readonly string[]).includes(value);
}

export interface RecordSubscriptionInput {
  userId: string;
  kind: SubscriptionKind;
  planId: string;
  planLabel: string;
  priceUsd: number;
  intervalLabel: string;
  periodStart: Date;
  periodEnd: Date;
  source?: "checkout" | "clerk";
  clerkSubscriptionId?: string | null;
  promoCode?: string | null;
  cardLast4?: string | null;
  autoRenew?: boolean;
  paystackAuthorizationCode?: string | null;
  paystackCustomerCode?: string | null;
  paystackEmail?: string | null;
  paystackPlanCode?: string | null;
  paystackSubscriptionCode?: string | null;
  paystackEmailToken?: string | null;
  paystackTransactionReference?: string | null;
}

/** Inserts a subscription record for an entitlement that was just granted. */
export async function recordSubscription(input: RecordSubscriptionInput): Promise<string> {
  const id = randomUUID();
  await db.insert(tandemSubscriptionsTable).values({
    id,
    userId: input.userId,
    kind: input.kind,
    planId: input.planId,
    planLabel: input.planLabel,
    priceUsd: input.priceUsd,
    status: "ACTIVE",
    intervalLabel: input.intervalLabel,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    source: input.source ?? "checkout",
    clerkSubscriptionId: input.clerkSubscriptionId ?? null,
    promoCode: input.promoCode ?? null,
    cardLast4: input.cardLast4 ?? null,
    autoRenew: input.autoRenew === true,
    paystackAuthorizationCode: input.paystackAuthorizationCode ?? null,
    paystackCustomerCode: input.paystackCustomerCode ?? null,
    paystackEmail: input.paystackEmail ?? null,
    paystackPlanCode: input.paystackPlanCode ?? null,
    paystackSubscriptionCode: input.paystackSubscriptionCode ?? null,
    paystackEmailToken: input.paystackEmailToken ?? null,
    paystackTransactionReference: input.paystackTransactionReference ?? null,
  });
  return id;
}

/** Human-readable 400 message for an unknown kind/plan pair. */
export function unknownProductMessage(kind: SubscriptionKind, planId: string): string {
  return kind === "pass"
    ? `Unknown category: ${planId}`
    : kind === "storage"
      ? `Unknown storage plan: ${planId}`
      : `Unknown projects plan: ${planId}`;
}

export interface ApplySubscriptionPurchaseInput {
  userId: string;
  kind: SubscriptionKind;
  planId: string;
  planLabel: string;
  /** Total actually charged/paid, in USD cents (after any promo discount). */
  priceUsd: number;
  intervalLabel: string;
  promoCode?: string | null;
  cardLast4?: string | null;
  source?: "checkout" | "clerk";
  /** Sign this subscription up for server-managed auto-renewal (pass only). */
  autoRenew?: boolean;
  /** Card authorization + customer details kept for renewals (paystack). */
  paystackAuthorizationCode?: string | null;
  paystackCustomerCode?: string | null;
  paystackEmail?: string | null;
  /** The Paystack plan + recurring subscription this row bills on. */
  paystackPlanCode?: string | null;
  paystackSubscriptionCode?: string | null;
  paystackEmailToken?: string | null;
  /** The Paystack charge that granted this row (idempotency for webhooks). */
  paystackTransactionReference?: string | null;
  /** When this purchase is an auto-renewal of an existing row, the id of the
      row being renewed — cleared of auto-renew so only the newest record is
      the live renewal (one charge chain per pass). */
  renewsSubscriptionId?: string | null;
}

export interface AppliedSubscription {
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Apply a paid subscription: grants the entitlement (a category ticket that
 * stacks onto the current pass, or extra storage/projects on the account
 * quota), records the subscription, and bumps the promo code's use count.
 * This is the single grant point used by every checkout path (the card
 * checkout, the Paystack webhook, and the Paystack verify-on-return), so a
 * paid plan always lands the same way.
 */
/**
 * True when a granted subscription should carry the auto-renewal flag: the
 * checkout signed the customer up for a Paystack plan (autoRenew is on unless
 * an admin turned it off for the plan), or this row is the renewal of an
 * existing auto-renewing chain. Paystack holds the card and bills the plan on
 * its own, so no local authorization code is required. Applies to every kind
 * — passes, storage, and projects.
 */
function shouldAutoRenew(input: {
  kind: SubscriptionKind;
  autoRenew?: boolean;
  paystackAuthorizationCode?: string | null;
  renewsSubscriptionId?: string | null;
}): boolean {
  if (input.renewsSubscriptionId) return true; // a renewal of an auto-renew row
  return input.autoRenew === true;
}

export async function applySubscriptionPurchase(
  input: ApplySubscriptionPurchaseInput,
): Promise<AppliedSubscription> {
  const now = new Date();
  let periodStart: Date = now;
  let periodEnd: Date;

  if (input.kind === "pass") {
    const category = input.planId as TicketCategory;
    // Renewing while the pass is still live extends it; otherwise 1 month from now.
    const [existing] = await db
      .select()
      .from(tandemTicketsTable)
      .where(
        and(
          eq(tandemTicketsTable.userId, input.userId),
          eq(tandemTicketsTable.category, category),
          gt(tandemTicketsTable.expiresAt, now),
        ),
      )
      .orderBy(tandemTicketsTable.expiresAt)
      .limit(1);
    const base = existing && existing.expiresAt.getTime() > Date.now() ? existing.expiresAt : now;
    periodStart = base;
    periodEnd = new Date(base.getTime() + SUBSCRIPTION_PERIOD_MS);
    await db.insert(tandemTicketsTable).values({
      id: randomUUID(),
      userId: input.userId,
      category,
      priceUsd: input.priceUsd,
      promoCode: input.promoCode ?? null,
      cardLast4: input.cardLast4 ?? "",
      expiresAt: periodEnd,
    });
  } else {
    const quota = await getOrCreateQuota(input.userId);
    periodEnd = new Date(now.getTime() + SUBSCRIPTION_PERIOD_MS);
    await db
      .update(tandemAccountQuotasTable)
      .set(
        input.kind === "storage"
          ? { storageLimitBytes: quota.storageLimitBytes + storagePlanBytes(input.planId) }
          : { projectLimit: quota.projectLimit + projectPlanCount(input.planId) },
      )
      .where(eq(tandemAccountQuotasTable.userId, input.userId));
  }

  if (input.promoCode) {
    await db
      .update(tandemPromoCodesTable)
      .set({ uses: sql`${tandemPromoCodesTable.uses} + 1` })
      .where(eq(tandemPromoCodesTable.code, input.promoCode));
    // One redemption per person — this is what makes a shared code safe to
    // hand out to many people. (Validated before checkout; kept authoritative
    // here so racing purchases can never double-redeem.)
    await db
      .insert(tandemPromoRedemptionsTable)
      .values({ code: input.promoCode, userId: input.userId })
      .onConflictDoNothing();
  }

  const autoRenew = shouldAutoRenew(input);
  const subscriptionId = await recordSubscription({
    userId: input.userId,
    kind: input.kind,
    planId: input.planId,
    planLabel: input.planLabel,
    priceUsd: input.priceUsd,
    intervalLabel: input.intervalLabel,
    periodStart,
    periodEnd,
    source: input.source ?? "checkout",
    promoCode: input.promoCode ?? null,
    cardLast4: input.cardLast4 ?? null,
    autoRenew,
    paystackAuthorizationCode: input.paystackAuthorizationCode ?? null,
    paystackCustomerCode: input.paystackCustomerCode ?? null,
    paystackEmail: input.paystackEmail ?? null,
    paystackPlanCode: input.paystackPlanCode ?? null,
    paystackSubscriptionCode: input.paystackSubscriptionCode ?? null,
    paystackEmailToken: input.paystackEmailToken ?? null,
    paystackTransactionReference: input.paystackTransactionReference ?? null,
  });

  // The row this renewal extended stops being the live auto-renew record —
  // the new row above takes over (keeps exactly one renewal chain per pass).
  if (input.renewsSubscriptionId) {
    await db
      .update(tandemSubscriptionsTable)
      .set({ autoRenew: false })
      .where(eq(tandemSubscriptionsTable.id, input.renewsSubscriptionId));
  }

  return { subscriptionId, periodStart, periodEnd };
}

export interface UserSubscriptionView {
  id: string;
  kind: SubscriptionKind;
  planId: string;
  planLabel: string;
  priceUsd: number;
  status: string;
  intervalLabel: string;
  periodStart: string;
  periodEnd: string;
  source: string;
  promoCode: string | null;
  cardLast4: string | null;
  /** Server-managed renewal is on for this subscription (category passes). */
  autoRenew: boolean;
  /** When the last auto-renew charge failed, why (shown to the user). */
  renewalFailure: string | null;
  active: boolean;
}

/** Lists every subscription a user has made, newest first, with live `active`. */
export async function listUserSubscriptions(userId: string): Promise<UserSubscriptionView[]> {
  const rows = await db
    .select()
    .from(tandemSubscriptionsTable)
    .where(eq(tandemSubscriptionsTable.userId, userId))
    .orderBy(desc(tandemSubscriptionsTable.createdAt));
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as SubscriptionKind,
    planId: row.planId,
    planLabel: row.planLabel,
    priceUsd: row.priceUsd,
    status: row.status,
    intervalLabel: row.intervalLabel,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    source: row.source,
    promoCode: row.promoCode,
    cardLast4: row.cardLast4,
    autoRenew: row.autoRenew === true,
    renewalFailure: row.renewalFailure ?? null,
    active: row.status === "ACTIVE" && row.periodEnd.getTime() > now,
  }));
}