import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Subscriptions — the single record of every purchase across NEXET (category
// passes), the Creator Den (workspace storage) and the Author Den (project
// count). One row per purchased subscription, so a "Subscriptions" page can
// show every subscription done: its type, the plan, what it cost, status, and
// when it expires. Billing is handled by Clerk Commerce when configured; the
// row is written/updated from the app checkout and from the Clerk webhook.
// ---------------------------------------------------------------------------

export const nexetSubscriptionsTable = pgTable("nexet_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  // pass | storage | projects
  kind: text("kind").notNull(),
  // pass → the category (authors | content-creators); storage/projects → the
  // plan id (g200 | g500 | tb1 | p10 | p50 | p200).
  planId: text("plan_id").notNull(),
  planLabel: text("plan_label").notNull(),
  // What the user pays for this subscription, in USD cents (after promo).
  priceUsd: integer("price_usd").notNull(),
  // ACTIVE | CANCELED | EXPIRED | PAST_DUE
  status: text("status").notNull().default("ACTIVE"),
  intervalLabel: text("interval_label").notNull().default(""),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  // checkout (in-app) | clerk (Clerk Commerce webhook)
  source: text("source").notNull().default("checkout"),
  // Clerk Commerce subscription id, when billed through Clerk.
  clerkSubscriptionId: text("clerk_subscription_id"),
  promoCode: text("promo_code"),
  cardLast4: text("card_last_4"),
  // Server-managed auto-renewal. Every Whop subscription (pass, storage,
  // projects) is signed up by default and only an administrator can turn it
  // off. True keeps the card on file, charging every cycle.
  autoRenew: boolean("auto_renew").notNull().default(false),
  // The Whop membership (mem_…) this row bills on — Whop re-charges the saved
  // card each cycle and fires payment.succeeded. The admin toggle flips its
  // cancel_at_period_end flag instead of calling enable/disable endpoints.
  whopMembershipId: text("whop_membership_id"),
  whopPlanId: text("whop_plan_id"),
  whopEmail: text("whop_email"),
  // The Whop payment (pay_…) that granted this row — makes the webhook grant
  // idempotent for subscription charges (which have no intent).
  whopPaymentId: text("whop_payment_id"),
  // When the last auto-renew charge failed, why (shown on the subscriptions
  // page); cleared when a charge succeeds or the user re-enables.
  renewalFailure: text("renewal_failure"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNexetSubscriptionSchema = createInsertSchema(nexetSubscriptionsTable);

export type NexetSubscription = typeof nexetSubscriptionsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Subscription plan settings — the few operational knobs an admin can turn on
// the code-defined plan catalog without a redeploy. Keyed by (kind, planId)
// matching the plan ids used across the checkout paths. Only rows that exist
// here override a plan's default.
// ---------------------------------------------------------------------------

export const nexetSubscriptionPlanSettingsTable = pgTable(
  "nexet_subscription_plan_settings",
  {
    // pass | storage | projects
    kind: text("kind").notNull(),
    // pass → the category (authors | content-creators); storage/projects → the
    // plan id (g200 | g500 | tb1 | p10 | p50 | p200).
    planId: text("plan_id").notNull(),
    // Whether purchases of this plan auto-renew by default. Every plan is on
    // unless an admin writes a row switching it off.
    autoRenewAvailable: boolean("auto_renew_available").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.planId] })],
);

export const insertNexetSubscriptionPlanSettingSchema = createInsertSchema(nexetSubscriptionPlanSettingsTable);

export type NexetSubscriptionPlanSetting = typeof nexetSubscriptionPlanSettingsTable.$inferSelect;