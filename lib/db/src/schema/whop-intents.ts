import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Whop payment intents — one row per checkout session opened with Whop for a
// NEXET subscription (category pass, workspace storage, or projects). Written
// as PENDING when the checkout URL is created, then flipped to SUCCESS
// (entitlement granted) or FAILED by the payment.succeeded / payment.failed
// webhook or the post-redirect confirm call. The unique reference makes
// granting idempotent: webhook and confirm-verify can race without
// double-granting.
// ---------------------------------------------------------------------------

export const nexetWhopIntentsTable = pgTable("nexet_whop_intents", {
  // Our own checkout reference — minted server-side (whp_<uuid>) and carried
  // in the Whop checkout-configuration metadata; Whop echoes it back on the
  // webhook payload so the grant can be matched to this row.
  reference: text("reference").primaryKey(),
  userId: text("user_id").notNull(),
  // pass | storage | projects
  kind: text("kind").notNull(),
  // pass → the category (authors | content-creators); storage/projects → the
  // plan id (g200 | g500 | tb1 | p10 | p50 | p200).
  planId: text("plan_id").notNull(),
  planLabel: text("plan_label").notNull(),
  intervalLabel: text("interval_label").notNull().default(""),
  // Amount the customer was charged, in USD cents (after any promo discount).
  // Whop reports payments in whole dollars — the webhook amount is converted
  // back to cents and must match this before the entitlement is granted.
  amountUsd: integer("amount_usd").notNull(),
  // Always USD — Whop settles this account in USD.
  currency: text("currency").notNull().default("USD"),
  // PENDING | SUCCESS | FAILED
  status: text("status").notNull().default("PENDING"),
  promoCode: text("promo_code"),
  // Last four digits of the card, filled in from the Whop payment response
  // once the charge succeeds.
  cardLast4: text("card_last_4"),
  // True when this checkout signed the subscription up for Whop-managed
  // auto-renewal — on for every Whop purchase unless an admin turned it off
  // for the plan; renewal charges re-bill the saved card through the
  // membership.
  autoRenew: boolean("auto_renew").notNull().default(false),
  // For renewal charges: the subscription row being renewed, so the grant can
  // hand the extension to the right record and no two cycles ever double-charge.
  renewalFor: text("renewal_for"),
  // The customer email used to open the checkout — Whop bills the membership
  // against it on renewal.
  customerEmail: text("customer_email"),
  // The Whop payment (pay_…) and membership (mem_…) created for this intent —
  // captured from the first payment.succeeded webhook and used to match later
  // recurring charges to the subscription chain.
  whopPaymentId: text("whop_payment_id"),
  whopMembershipId: text("whop_membership_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNexetWhopIntentSchema = createInsertSchema(nexetWhopIntentsTable);

export type NexetWhopIntent = typeof nexetWhopIntentsTable.$inferSelect;