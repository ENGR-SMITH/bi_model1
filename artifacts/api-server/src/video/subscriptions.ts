import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  nexetAccountQuotasTable,
  nexetPromoCodesTable,
  nexetPromoRedemptionsTable,
  nexetSubscriptionPlanSettingsTable,
  nexetSubscriptionsTable,
  nexetTicketsTable,
} from "@workspace/db";
import {
  STORAGE_PLANS,
  PROJECT_PLANS,
  getOrCreateQuota,
  DEFAULT_STORAGE_LIMIT_BYTES,
  DEFAULT_PROJECT_LIMIT,
} from "./quota";
import { PASS_PRICE_USD, TICKET_CATEGORIES, type TicketCategory } from "../routes/tickets";

// ---------------------------------------------------------------------------
// Subscriptions — a unified view of the three purchase products across the
// apps: NEXET category passes, Creator Den workspace storage, and Author Den
// projects. This module owns the plan catalog and the record of every
// subscription a user has made, so any surface (the NEXET Subscriptions page
// or the in-app checkout modals) can read it back with type / status / expiry
// and usage.
// ---------------------------------------------------------------------------

export type SubscriptionKind = "pass" | "storage" | "projects";

/** One subscription period — a month. Every plan bills monthly via Whop. */
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
  // Every Whop subscription auto-renews by default — passes, storage, and
  // project plans alike. Only an admin can turn it off, either here (per
  // plan) or on an individual subscription row.
  return true;
}

/**
 * Resolve whether customers may turn on server-managed auto-renewal for one
 * plan: a row in nexet_subscription_plan_settings (written by an admin) wins,
 * otherwise the code-defined default (on for every plan kind).
 */
export async function autoRenewAvailableForPlan(kind: SubscriptionKind, planId: string): Promise<boolean> {
  const [setting] = await db
    .select({ autoRenewAvailable: nexetSubscriptionPlanSettingsTable.autoRenewAvailable })
    .from(nexetSubscriptionPlanSettingsTable)
    .where(
      and(
        eq(nexetSubscriptionPlanSettingsTable.kind, kind),
        eq(nexetSubscriptionPlanSettingsTable.planId, planId),
      ),
    )
    .limit(1);
  return setting ? setting.autoRenewAvailable : defaultAutoRenewAvailable(kind);
}

export async function subscriptionPlans(): Promise<SubscriptionPlan[]> {
  const overrides = await db.select().from(nexetSubscriptionPlanSettingsTable);
  const availableFor = (kind: SubscriptionKind, planId: string): boolean => {
    const row = overrides.find((setting) => setting.kind === kind && setting.planId === planId);
    return row ? row.autoRenewAvailable : defaultAutoRenewAvailable(kind);
  };

  // Every plan bills monthly through a Whop renewal plan — the pass and the
  // storage/project extensions all share the same one-month rhythm.
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
 * and the Whop checkout so a plan always prices the same everywhere.
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
  whopMembershipId?: string | null;
  whopPlanId?: string | null;
  whopEmail?: string | null;
  whopPaymentId?: string | null;
}

/** Inserts a subscription record for an entitlement that was just granted. */
export async function recordSubscription(input: RecordSubscriptionInput): Promise<string> {
  const id = randomUUID();
  await db.insert(nexetSubscriptionsTable).values({
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
    whopMembershipId: input.whopMembershipId ?? null,
    whopPlanId: input.whopPlanId ?? null,
    whopEmail: input.whopEmail ?? null,
    whopPaymentId: input.whopPaymentId ?? null,
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
  /** The Whop membership + plan this row bills on. */
  whopMembershipId?: string | null;
  whopPlanId?: string | null;
  whopEmail?: string | null;
  /** The Whop payment that granted this row (idempotency for webhooks). */
  whopPaymentId?: string | null;
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
 * checkout, the Whop webhook, and the Whop confirm-on-return), so a paid
 * plan always lands the same way.
 */
/**
 * True when a granted subscription should carry the auto-renewal flag: the
 * checkout signed the customer up for a Whop renewal plan (autoRenew is on
 * unless an admin turned it off for the plan), or this row is the renewal of
 * an existing auto-renewing chain. Whop holds the card and bills the plan on
 * its own, so no local authorization code is required. Applies to every kind
 * — passes, storage, and projects.
 */
function shouldAutoRenew(input: {
  kind: SubscriptionKind;
  autoRenew?: boolean;
  whopMembershipId?: string | null;
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
      .from(nexetTicketsTable)
      .where(
        and(
          eq(nexetTicketsTable.userId, input.userId),
          eq(nexetTicketsTable.category, category),
          gt(nexetTicketsTable.expiresAt, now),
        ),
      )
      .orderBy(nexetTicketsTable.expiresAt)
      .limit(1);
    const base = existing && existing.expiresAt.getTime() > Date.now() ? existing.expiresAt : now;
    periodStart = base;
    periodEnd = new Date(base.getTime() + SUBSCRIPTION_PERIOD_MS);
    await db.insert(nexetTicketsTable).values({
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
      .update(nexetAccountQuotasTable)
      .set(
        input.kind === "storage"
          ? { storageLimitBytes: quota.storageLimitBytes + storagePlanBytes(input.planId) }
          : { projectLimit: quota.projectLimit + projectPlanCount(input.planId) },
      )
      .where(eq(nexetAccountQuotasTable.userId, input.userId));
  }

  if (input.promoCode) {
    await db
      .update(nexetPromoCodesTable)
      .set({ uses: sql`${nexetPromoCodesTable.uses} + 1` })
      .where(eq(nexetPromoCodesTable.code, input.promoCode));
    // One redemption per person — this is what makes a shared code safe to
    // hand out to many people. (Validated before checkout; kept authoritative
    // here so racing purchases can never double-redeem.)
    await db
      .insert(nexetPromoRedemptionsTable)
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
    whopMembershipId: input.whopMembershipId ?? null,
    whopPlanId: input.whopPlanId ?? null,
    whopEmail: input.whopEmail ?? null,
    whopPaymentId: input.whopPaymentId ?? null,
  });

  // The row this renewal extended stops being the live auto-renew record —
  // the new row above takes over (keeps exactly one renewal chain per pass).
  if (input.renewsSubscriptionId) {
    await db
      .update(nexetSubscriptionsTable)
      .set({ autoRenew: false })
      .where(eq(nexetSubscriptionsTable.id, input.renewsSubscriptionId));
  }

  return { subscriptionId, periodStart, periodEnd };
}

// ---------------------------------------------------------------------------
// Taking a grant back — the reversal half of `applySubscriptionPurchase`.
//
// A refund must cut access *now*, not at the end of the paid period, so the
// same entitlement the grant created is removed the moment Whop reports the
// reversal. Every field needed to identify what to remove (and to put it back
// if the reversal is itself reversed, e.g. a dispute we win) travels in the
// reference below, and the pass ticket is matched by the exact expiry the
// grant stamped on it — so a second, separately-paid pass is never collateral
// damage.
// ---------------------------------------------------------------------------

/** What one subscription row granted, enough to revoke it and to restore it. */
export interface SubscriptionEntitlementRef {
  userId: string;
  kind: SubscriptionKind;
  planId: string;
  /** The period this row granted — also the expiry stamped on its ticket. */
  periodEnd: Date;
  priceUsd: number;
  promoCode?: string | null;
  cardLast4?: string | null;
}

/** What a revocation or restoration actually changed. */
export interface EntitlementChange {
  /** A pass ticket was removed (revoke) or re-created (restore). */
  ticketChanged: boolean;
  /** Storage bytes taken back / given again. */
  storageBytes: number;
  /** Project slots taken back / given again. */
  projectSlots: number;
  /** Anything a human should look at — the caller logs these. */
  warnings: string[];
}

/**
 * The database handle, or an open transaction. Accepting either lets a
 * revocation and the subscription row that records it commit together, so
 * access can never be cut without the record saying so — or vice versa.
 */
type SubscriptionDbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

function emptyChange(): EntitlementChange {
  return { ticketChanged: false, storageBytes: 0, projectSlots: 0, warnings: [] };
}

/**
 * Remove, immediately, the access a subscription granted: its pass ticket, or
 * the storage/project credits it added to the account quota.
 *
 * Safe to run twice — deleting a ticket that is already gone is a no-op, and
 * the caller claims the row's status first so a redelivered webhook cannot
 * subtract the same credits twice.
 */
export async function revokeSubscriptionEntitlement(
  ref: SubscriptionEntitlementRef,
  executor: SubscriptionDbExecutor = db,
): Promise<EntitlementChange> {
  const change = emptyChange();

  if (ref.kind === "pass") {
    if (!isPassCategory(ref.planId)) return change;
    const category = ref.planId;

    // The grant stamped this row's `periodEnd` onto the ticket it created, so
    // that exact expiry identifies *this* purchase's ticket.
    const [exact] = await executor
      .select({ id: nexetTicketsTable.id })
      .from(nexetTicketsTable)
      .where(
        and(
          eq(nexetTicketsTable.userId, ref.userId),
          eq(nexetTicketsTable.category, category),
          eq(nexetTicketsTable.expiresAt, ref.periodEnd),
        ),
      )
      .limit(1);

    let ticketId = exact?.id ?? null;
    if (!ticketId) {
      // Nothing matched exactly. Rather than guess which pass to cut, only do
      // it when the choice is unambiguous: exactly one live pass for the
      // category. Anything else is flagged for a human instead of blind-cut.
      const live = await executor
        .select({ id: nexetTicketsTable.id })
        .from(nexetTicketsTable)
        .where(
          and(
            eq(nexetTicketsTable.userId, ref.userId),
            eq(nexetTicketsTable.category, category),
            gt(nexetTicketsTable.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(nexetTicketsTable.expiresAt));
      if (live.length === 1) {
        ticketId = live[0].id;
        change.warnings.push(
          "refund: pass ticket matched by elimination (one live pass), not by exact expiry",
        );
      } else if (live.length > 1) {
        change.warnings.push(
          `refund: ${live.length} live passes for ${category} and none matched this purchase — cut one manually`,
        );
      }
    }

    if (ticketId) {
      await executor.delete(nexetTicketsTable).where(eq(nexetTicketsTable.id, ticketId));
      change.ticketChanged = true;
    }
    return change;
  }

  // Storage / projects: take back exactly the credits this purchase added. The
  // quota row holds the running total, so the grant's own amount is what goes.
  const [quota] = await executor
    .select({
      storageLimitBytes: nexetAccountQuotasTable.storageLimitBytes,
      projectLimit: nexetAccountQuotasTable.projectLimit,
    })
    .from(nexetAccountQuotasTable)
    .where(eq(nexetAccountQuotasTable.userId, ref.userId))
    .limit(1);
  if (!quota) return change; // never granted — nothing to take back

  if (ref.kind === "storage") {
    const bytes = storagePlanBytes(ref.planId);
    if (bytes <= 0) return change;
    // Floored at the free tier: a refund can never push an account below what
    // every account starts with.
    const next = Math.max(DEFAULT_STORAGE_LIMIT_BYTES, quota.storageLimitBytes - bytes);
    const removed = quota.storageLimitBytes - next;
    if (removed <= 0) return change;
    await executor
      .update(nexetAccountQuotasTable)
      .set({ storageLimitBytes: next })
      .where(eq(nexetAccountQuotasTable.userId, ref.userId));
    change.storageBytes = removed;
    return change;
  }

  const count = projectPlanCount(ref.planId);
  if (count <= 0) return change;
  const next = Math.max(DEFAULT_PROJECT_LIMIT, quota.projectLimit - count);
  const removed = quota.projectLimit - next;
  if (removed <= 0) return change;
  await executor
    .update(nexetAccountQuotasTable)
    .set({ projectLimit: next })
    .where(eq(nexetAccountQuotasTable.userId, ref.userId));
  change.projectSlots = removed;
  return change;
}

/**
 * Give back the access a revocation took away — for a dispute decided in our
 * favour, where no money ended up leaving.
 *
 * Idempotent: it will not re-create a ticket that is already there, and the
 * caller only reaches it from the REFUNDED → ACTIVE claim. A period that has
 * already lapsed is left alone, because there would be no access to restore.
 */
export async function restoreSubscriptionEntitlement(
  ref: SubscriptionEntitlementRef,
  executor: SubscriptionDbExecutor = db,
): Promise<EntitlementChange> {
  const change = emptyChange();

  if (ref.kind === "pass") {
    if (!isPassCategory(ref.planId)) return change;
    if (ref.periodEnd.getTime() <= Date.now()) return change;
    const category = ref.planId;

    const [existing] = await executor
      .select({ id: nexetTicketsTable.id })
      .from(nexetTicketsTable)
      .where(
        and(
          eq(nexetTicketsTable.userId, ref.userId),
          eq(nexetTicketsTable.category, category),
          eq(nexetTicketsTable.expiresAt, ref.periodEnd),
        ),
      )
      .limit(1);
    if (existing) return change; // already granted — nothing to put back

    await executor.insert(nexetTicketsTable).values({
      id: randomUUID(),
      userId: ref.userId,
      category,
      priceUsd: ref.priceUsd,
      promoCode: ref.promoCode ?? null,
      cardLast4: ref.cardLast4 ?? "",
      expiresAt: ref.periodEnd,
    });
    change.ticketChanged = true;
    return change;
  }

  const [quota] = await executor
    .select({
      storageLimitBytes: nexetAccountQuotasTable.storageLimitBytes,
      projectLimit: nexetAccountQuotasTable.projectLimit,
    })
    .from(nexetAccountQuotasTable)
    .where(eq(nexetAccountQuotasTable.userId, ref.userId))
    .limit(1);
  if (!quota) return change;

  if (ref.kind === "storage") {
    const bytes = storagePlanBytes(ref.planId);
    if (bytes <= 0) return change;
    await executor
      .update(nexetAccountQuotasTable)
      .set({ storageLimitBytes: quota.storageLimitBytes + bytes })
      .where(eq(nexetAccountQuotasTable.userId, ref.userId));
    change.storageBytes = bytes;
    return change;
  }

  const count = projectPlanCount(ref.planId);
  if (count <= 0) return change;
  await executor
    .update(nexetAccountQuotasTable)
    .set({ projectLimit: quota.projectLimit + count })
    .where(eq(nexetAccountQuotasTable.userId, ref.userId));
  change.projectSlots = count;
  return change;
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
    .from(nexetSubscriptionsTable)
    .where(eq(nexetSubscriptionsTable.userId, userId))
    .orderBy(desc(nexetSubscriptionsTable.createdAt));
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