import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Paystack plan registry — one row per catalog plan that has been mirrored as
// a Paystack recurring plan (POST /plan). Paystack bills these plans monthly
// on its own and fires charge.success each cycle, so the checkout reuses the
// same plan code instead of creating a duplicate plan on every purchase.
// Keyed by (kind, planId) matching the plan ids used across the checkout.
// ---------------------------------------------------------------------------

export const tandemPaystackPlansTable = pgTable(
  "tandem_paystack_plans",
  {
    // pass | storage | projects
    kind: text("kind").notNull(),
    // pass → the category (authors | content-creators); storage/projects → the
    // plan id (g200 | g500 | tb1 | p10 | p50 | p200).
    planId: text("plan_id").notNull(),
    // Paystack plan code (PLN_…) used at checkout to subscribe the customer.
    planCode: text("plan_code").notNull(),
    // The monthly amount the plan charges, in USD cents — must match the
    // catalog price so webhook amount checks stay in sync.
    amountUsd: integer("amount_usd").notNull(),
    // Paystack billing interval — always "monthly" for these plans.
    interval: text("interval").notNull().default("monthly"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.kind, table.planId] })],
);

export const insertTandemPaystackPlanSchema = createInsertSchema(tandemPaystackPlansTable);

export type TandemPaystackPlan = typeof tandemPaystackPlansTable.$inferSelect;