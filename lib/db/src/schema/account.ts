import { createInsertSchema } from "drizzle-zod";
import { date, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Account-level limits — the workspace storage bar (Creator Den) and the
// project-count bar (Author Den). Each Tandem account starts with a free
// quota (2 GB of project storage / 5 projects) and can extend it by buying a
// plan; the applied limit lives here and grows as plans are purchased.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Daily storage snapshots — the metering ledger behind the storage bar.
// R2 does not bill per account; a nightly job records how many physical bytes
// each project (and thus each owner account) actually stores — originals +
// derived artifacts, split by storage provider (R2 vs local processing disk).
// ---------------------------------------------------------------------------
export const tandemVideoStorageSnapshotsTable = pgTable(
  "tandem_video_storage_snapshots",
  {
    projectId: text("project_id").notNull(),
    ownerId: text("owner_id").notNull(),
    day: date("day").notNull(),
    // Total physical bytes stored for the project that day.
    totalBytes: integer("total_bytes").notNull().default(0),
    // Bytes held in R2 (billable at the R2 rate) vs local processing disk.
    r2Bytes: integer("r2_bytes").notNull().default(0),
    localBytes: integer("local_bytes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectDayUnique: unique("tandem_video_storage_snapshot_project_day").on(table.projectId, table.day),
  }),
);

export const insertTandemVideoStorageSnapshotSchema = createInsertSchema(tandemVideoStorageSnapshotsTable);

export type TandemVideoStorageSnapshot = typeof tandemVideoStorageSnapshotsTable.$inferSelect;

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
