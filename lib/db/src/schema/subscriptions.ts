import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTandemSubscriptionSchema = createInsertSchema(tandemSubscriptionsTable);

export type TandemSubscription = typeof tandemSubscriptionsTable.$inferSelect;