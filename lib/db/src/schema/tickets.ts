import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// NEXET category passes — the ticket 🎫 paywall. Each available category
// (authors, content-creators) requires an active pass: $5.88 / month (billed
// monthly by Paystack). One pass per (user, category); renewing extends the
// current pass when it is still active. FREE promo codes grant a free month.
// ---------------------------------------------------------------------------

export const nexetTicketsTable = pgTable("nexet_tickets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  // authors | content-creators
  category: text("category").notNull(),
  // What the user actually paid, in USD cents (after any promo discount).
  priceUsd: integer("price_usd").notNull(),
  // Promo code used, if any.
  promoCode: text("promo_code"),
  // Last four digits of the card on the receipt (payment detail is not kept).
  cardLast4: text("card_last_4").notNull(),
  purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// NEXET category tours — the one-time 10-minute preview a new visitor gets
// in a den before buying that category's pass. One row per (user, category)
// ever: granting the tour twice is impossible, so once the 10 minutes are up
// the only way back in is an active pass.
// ---------------------------------------------------------------------------

export const nexetToursTable = pgTable("nexet_tours", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  // authors | content-creators (each den has its own independent tour)
  category: text("category").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
});

export const nexetPromoCodesTable = pgTable("nexet_promo_codes", {
  code: text("code").primaryKey(),
  // FREE (waive the fee) | PERCENT (percent off) | FLAT (cents off)
  kind: text("kind").notNull(),
  // PERCENT: percent off (e.g. 50). FLAT: cents off (e.g. 50). FREE: unused.
  value: integer("value").notNull().default(0),
  // 0 = unlimited uses.
  maxUses: integer("max_uses").notNull().default(0),
  uses: integer("uses").notNull().default(0),
  // false = paused by an admin: the code stops validating but keeps its row,
  // usage history, and settings so it can be switched back on later.
  active: boolean("active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Promo redemptions — one row per (code, user), so a code can be shared by
// many people while each person can redeem it only once. Written by the same
// grant path that bumps the code's `uses` counter; the checkout refuses a
// code the caller has already redeemed.
// ---------------------------------------------------------------------------

export const nexetPromoRedemptionsTable = pgTable(
  "nexet_promo_redemptions",
  {
    code: text("code").notNull(),
    userId: text("user_id").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.code, table.userId] })],
);

export const insertNexetTicketSchema = createInsertSchema(nexetTicketsTable);
export const insertNexetPromoCodeSchema = createInsertSchema(nexetPromoCodesTable);
export const insertNexetPromoRedemptionSchema = createInsertSchema(nexetPromoRedemptionsTable);
export const insertNexetTourSchema = createInsertSchema(nexetToursTable);

export type NexetTicket = typeof nexetTicketsTable.$inferSelect;
export type NexetPromoCode = typeof nexetPromoCodesTable.$inferSelect;
export type NexetPromoRedemption = typeof nexetPromoRedemptionsTable.$inferSelect;
export type NexetTour = typeof nexetToursTable.$inferSelect;
