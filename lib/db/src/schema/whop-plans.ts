import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Whop plan registry — one row per catalog plan that has been mirrored as a
// Whop renewal plan (POST /plans). Whop bills these plans on its own rhythm
// (30 days = monthly) and fires payment.succeeded each cycle; checkout
// subscribes the customer to the plan via a checkout configuration.
// ---------------------------------------------------------------------------

export const nexetWhopPlansTable = pgTable(
  "nexet_whop_plans",
  {
    // pass | storage | projects
    kind: text("kind").notNull(),
    // pass → the category (authors | content-creators); storage/projects →
    // the plan id (g200 | g500 | tb1 | p10 | p50 | p200).
    planId: text("plan_id").notNull(),
    // Whop plan id (plan_…) used at checkout to subscribe the customer.
    whopPlanId: text("whop_plan_id").notNull(),
    // The monthly price this plan charges, in USD cents — what a recurring
    // charge must match before it is granted.
    amountUsd: integer("amount_usd").notNull(),
    // Whop billing interval in days — always 30 for these monthly plans.
    billingPeriodDays: integer("billing_period_days").notNull().default(30),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.planId] })],
);

export const insertNexetWhopPlanSchema = createInsertSchema(nexetWhopPlansTable);

export type NexetWhopPlan = typeof nexetWhopPlansTable.$inferSelect;