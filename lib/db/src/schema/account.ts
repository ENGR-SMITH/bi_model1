import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Account-level limits — the workspace storage bar (Creator Den) and the
// project-count bar (Author Den). Each Tandem account starts with a free
// quota (2 GB of project storage / 5 projects) and can extend it by buying a
// plan; the applied limit lives here and grows as plans are purchased.
// ---------------------------------------------------------------------------

export const tandemAccountQuotasTable = pgTable("tandem_account_quotas", {
  userId: text("user_id").primaryKey(),
  // Total storage the account may hold across its owned projects, in bytes.
  storageLimitBytes: integer("storage_limit_bytes").notNull(),
  // Total number of projects the account may create, across studios.
  projectLimit: integer("project_limit").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user's uploaded CV, served on their profile so other signed-in users can
// open it. One CV per account; re-uploading replaces the previous file.
export const tandemUserCvsTable = pgTable("tandem_user_cvs", {
  userId: text("user_id").primaryKey(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  // Basename of the blob under the upload dir (same disk as vault media).
  storageKey: text("storage_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTandemAccountQuotaSchema = createInsertSchema(tandemAccountQuotasTable);
export const insertTandemUserCvSchema = createInsertSchema(tandemUserCvsTable);

export type TandemAccountQuota = typeof tandemAccountQuotasTable.$inferSelect;
export type TandemUserCv = typeof tandemUserCvsTable.$inferSelect;
