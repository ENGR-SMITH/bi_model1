import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// TANDEM category passes — the ticket 🎫 paywall. Each available category
// (authors, content-creators) requires an active pass: $1.88 for 3 weeks.
// One pass per (user, category); re-purchasing extends the current pass when
// it is still active. Promo codes (server-managed) discount or waive the fee.
// ---------------------------------------------------------------------------

export const tandemTicketsTable = pgTable("tandem_tickets", {
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
// TANDEM category tours — the one-time 10-minute preview a new visitor gets
// in a den before buying that category's pass. One row per (user, category)
// ever: granting the tour twice is impossible, so once the 10 minutes are up
// the only way back in is an active pass.
// ---------------------------------------------------------------------------

export const tandemToursTable = pgTable("tandem_tours", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  // authors | content-creators (each den has its own independent tour)
  category: text("category").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
});

export const tandemPromoCodesTable = pgTable("tandem_promo_codes", {
  code: text("code").primaryKey(),
  // FREE (waive the fee) | PERCENT (percent off) | FLAT (cents off)
  kind: text("kind").notNull(),
  // PERCENT: percent off (e.g. 50). FLAT: cents off (e.g. 50). FREE: unused.
  value: integer("value").notNull().default(0),
  // 0 = unlimited uses.
  maxUses: integer("max_uses").notNull().default(0),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTandemTicketSchema = createInsertSchema(tandemTicketsTable);
export const insertTandemPromoCodeSchema = createInsertSchema(tandemPromoCodesTable);
export const insertTandemTourSchema = createInsertSchema(tandemToursTable);

export type TandemTicket = typeof tandemTicketsTable.$inferSelect;
export type TandemPromoCode = typeof tandemPromoCodesTable.$inferSelect;
export type TandemTour = typeof tandemToursTable.$inferSelect;
