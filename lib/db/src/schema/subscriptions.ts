import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Subscriptions — the single record of every purchase across TANDEM (category
// passes), the Creator Den (workspace storage) and the Author Den (project
// count). One row per purchased subscription, so a "Subscriptions" page can
// show every subscription done: its type, the plan, what it cost, status, and
// when it expires. Billing is handled by Clerk Commerce when configured; the
// row is written/updated from the app checkout and from the Clerk webhook.
// ---------------------------------------------------------------------------

export const tandemSubscriptionsTable = pgTable("tandem_subscriptions", {
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
  // Server-managed auto-renewal (category passes). True keeps the card on file
  // charging every pass cycle until the user turns it off.
  autoRenew: boolean("auto_renew").notNull().default(false),
  // Paystack card authorization + customer captured on first payment — what the
  // renewal scheduler re-charges without a fresh checkout.
  paystackAuthorizationCode: text("paystack_authorization_code"),
  paystackCustomerCode: text("paystack_customer_code"),
  paystackEmail: text("paystack_email"),
  // When the last auto-renew charge failed, why (shown on the subscriptions
  // page); cleared when a charge succeeds or the user re-enables.
  renewalFailure: text("renewal_failure"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTandemSubscriptionSchema = createInsertSchema(tandemSubscriptionsTable);

export type TandemSubscription = typeof tandemSubscriptionsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Subscription plan settings — the few operational knobs an admin can turn on
// the code-defined plan catalog without a redeploy. Keyed by (kind, planId)
// matching the plan ids used across the checkout paths. Only rows that exist
// here override a plan's default.
// ---------------------------------------------------------------------------

export const tandemSubscriptionPlanSettingsTable = pgTable(
  "tandem_subscription_plan_settings",
  {
    // pass | storage | projects
    kind: text("kind").notNull(),
    // pass → the category (authors | content-creators); storage/projects → the
    // plan id (g200 | g500 | tb1 | p10 | p50 | p200).
    planId: text("plan_id").notNull(),
    // Whether customers may turn on server-managed auto-renewal for this plan.
    autoRenewAvailable: boolean("auto_renew_available").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.planId] })],
);

export const insertTandemSubscriptionPlanSettingSchema = createInsertSchema(tandemSubscriptionPlanSettingsTable);

export type TandemSubscriptionPlanSetting = typeof tandemSubscriptionPlanSettingsTable.$inferSelect;