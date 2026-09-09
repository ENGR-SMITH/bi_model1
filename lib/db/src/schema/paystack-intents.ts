import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Paystack payment intents — one row per checkout session opened with Paystack
// for a NEXET subscription (category pass, workspace storage, or projects).
// Written as PENDING when the checkout URL is created, then flipped to SUCCESS
// (entitlement granted) or FAILED by the charge.success/charge.failed webhook
// or the post-redirect verify call. The unique reference makes granting
// idempotent: webhook and confirm-verify can race without double-granting.
// ---------------------------------------------------------------------------

export const nexetPaystackIntentsTable = pgTable("nexet_paystack_intents", {
  // Paystack transaction reference — minted server-side (tan_<uuid>) and sent
  // to Paystack at initialize; Paystack echoes it back on webhook/verify.
  reference: text("reference").primaryKey(),
  userId: text("user_id").notNull(),
  // pass | storage | projects
  kind: text("kind").notNull(),
  // pass → the category (authors | content-creators); storage/projects → the
  // plan id (g200 | g500 | tb1 | p10 | p50 | p200).
  planId: text("plan_id").notNull(),
  planLabel: text("plan_label").notNull(),
  intervalLabel: text("interval_label").notNull().default(""),
  // Amount charged to Paystack, in USD cents (after any promo discount). The
  // webhook/verify response must match this before the entitlement is granted.
  amountUsd: integer("amount_usd").notNull(),
  // Always USD — Paystack only settles this account in USD.
  currency: text("currency").notNull().default("USD"),
  // PENDING | SUCCESS | FAILED
  status: text("status").notNull().default("PENDING"),
  promoCode: text("promo_code"),
  // Last four digits of the card, filled in from the Paystack response once
  // the charge succeeds.
  cardLast4: text("card_last_4"),
  // True when this checkout signed the subscription up for server-managed
  // auto-renewal — on for every Paystack purchase unless an admin turned it
  // off for the plan; renewal intents re-charge the saved card.
  autoRenew: boolean("auto_renew").notNull().default(false),
  // For renewal charges: the subscription row being renewed, so the grant can
  // hand the extension to the right record and no two cycles ever double-charge.
  renewalFor: text("renewal_for"),
  // The customer email used to open the checkout — needed to re-charge the
  // saved authorization during renewal.
  customerEmail: text("customer_email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNexetPaystackIntentSchema = createInsertSchema(nexetPaystackIntentsTable);

export type NexetPaystackIntent = typeof nexetPaystackIntentsTable.$inferSelect;
