import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, tandemSubscriptionsTable } from "@workspace/db";
import { STORAGE_PLANS, PROJECT_PLANS } from "./quota";
import { PASS_PRICE_USD, PASS_WEEKS, TICKET_CATEGORIES, type TicketCategory } from "../routes/tickets";

// ---------------------------------------------------------------------------
// Subscriptions — a unified view of the three purchase products across the
// apps: TANDEM category passes, Creator Den workspace storage, and Author Den
// projects. This module owns the plan catalog and the record of every
// subscription a user has made, so any surface (the TANDEM Subscriptions page
// or the in-app checkout modals) can read it back with type / status / expiry
// and usage.
// ---------------------------------------------------------------------------

export type SubscriptionKind = "pass" | "storage" | "projects";

/** One purchasable subscription product shown on the payments page. */
export interface SubscriptionPlan {
  kind: SubscriptionKind;
  planId: string;
  planLabel: string;
  priceUsd: number;
  intervalLabel: string;
  detail: string;
}

export function subscriptionPlans(): SubscriptionPlan[] {
  const passes: SubscriptionPlan[] = TICKET_CATEGORIES.map((category) => ({
    kind: "pass",
    planId: category,
    planLabel: category === "authors" ? "Author & Writer pass" : "Content Creators pass",
    priceUsd: PASS_PRICE_USD,
    intervalLabel: `${PASS_WEEKS} weeks`,
    detail: `A ticket into the ${category === "authors" ? "Author&pos;s Atrium" : "Content Creators room"} for ${PASS_WEEKS} weeks`,
  }));

  const storage: SubscriptionPlan[] = STORAGE_PLANS.map((plan) => ({
    kind: "storage",
    planId: plan.id,
    planLabel: plan.label,
    priceUsd: plan.priceUsd,
    intervalLabel: "recurring",
    detail: `Extend your workspace storage with another ${plan.label}`,
  }));

  const projects: SubscriptionPlan[] = PROJECT_PLANS.map((plan) => ({
    kind: "projects",
    planId: plan.id,
    planLabel: `+${plan.count} projects`,
    priceUsd: plan.priceUsd,
    intervalLabel: "one-time",
    detail: plan.label,
  }));

  return [...passes, ...storage, ...projects];
}

/** Bytes added for a storage plan id, or 0. */
export function storagePlanBytes(planId: string): number {
  return STORAGE_PLANS.find((plan) => plan.id === planId)?.bytes ?? 0;
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
  });
  return id;
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
    active: row.status === "ACTIVE" && row.periodEnd.getTime() > now,
  }));
}