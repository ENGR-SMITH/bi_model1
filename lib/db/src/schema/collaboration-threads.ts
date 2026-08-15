import { createInsertSchema } from "drizzle-zod";
import {
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const collaborationThreadsTable = pgTable(
  "collaboration_threads",
  {
    id: text("id").primaryKey(),
    continuationId: text("continuation_id").notNull(),
    creatorId: text("creator_id").notNull(),
    respondentId: text("respondent_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    continuationUnique: unique("collaboration_thread_continuation_unique").on(table.continuationId),
  }),
);

export const collaborationMessagesTable = pgTable("collaboration_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  senderId: text("sender_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCollaborationThreadSchema = createInsertSchema(collaborationThreadsTable);
export const insertCollaborationMessageSchema = createInsertSchema(collaborationMessagesTable);

export type CollaborationThread = typeof collaborationThreadsTable.$inferSelect;
export type CollaborationMessage = typeof collaborationMessagesTable.$inferSelect;