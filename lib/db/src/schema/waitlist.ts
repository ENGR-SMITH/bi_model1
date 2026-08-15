import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const waitlistTable = pgTable(
  "waitlist",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    categorySlug: text("category_slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCategoryUnique: unique("waitlist_user_category_unique").on(
      table.userId,
      table.categorySlug,
    ),
  }),
);

export const insertWaitlistSchema = createInsertSchema(waitlistTable);

export type InsertWaitlist = z.infer<typeof insertWaitlistSchema>;
export type WaitlistEntry = typeof waitlistTable.$inferSelect;