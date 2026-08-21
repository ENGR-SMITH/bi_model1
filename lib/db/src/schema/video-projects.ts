import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Content Creators — pre-recorded video production (the "Tandem" 4-leg relay).
// All tables are prefixed `tandem_` so they never collide with the parent
// app's tables in the shared PostgreSQL database.
// ---------------------------------------------------------------------------

export const tandemVideoProjectsTable = pgTable("tandem_video_projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // VAULT → IN_PRODUCTION → LOCK_RELEASED → COMPLETE
  status: text("status").notNull().default("VAULT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per (project, user). The Captain is the owner; every leg role maps
// to one of the roles below. Identity is the Clerk user id, shared with the
// rest of the parent app.
export const tandemVideoMembersTable = pgTable(
  "tandem_video_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("VIEWER"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectUserUnique: unique("tandem_video_member_project_user").on(
      table.projectId,
      table.userId,
    ),
  }),
);

// A raw asset in the locked vault. Files are stored server-side (disk today,
// object storage later); the row records metadata only. Proxy/transcript
// artifacts and versioned files (AssetFile) arrive with the processing
// pipeline milestone.
export const tandemVideoAssetsTable = pgTable("tandem_video_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  uploaderId: text("uploader_id").notNull(),
  kind: text("kind").notNull().default("RAW_VIDEO"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  durationMs: integer("duration_ms"),
  storageKey: text("storage_key").notNull(),
  // UPLOADED → PROCESSING → READY → FAILED
  status: text("status").notNull().default("UPLOADED"),
  // Raw upload is version 0; processed artifacts increment it (Git-style).
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTandemVideoProjectSchema = createInsertSchema(tandemVideoProjectsTable);
export const insertTandemVideoMemberSchema = createInsertSchema(tandemVideoMembersTable);
export const insertTandemVideoAssetSchema = createInsertSchema(tandemVideoAssetsTable);

export type TandemVideoProject = typeof tandemVideoProjectsTable.$inferSelect;
export type TandemVideoMember = typeof tandemVideoMembersTable.$inferSelect;
export type TandemVideoAsset = typeof tandemVideoAssetsTable.$inferSelect;
export type TandemVideoRole = "CAPTAIN" | "UPLOADER" | "ARCHITECT" | "VISUAL_EDITOR" | "SOUND_DESIGNER" | "MOTION_COLOR" | "THUMBNAIL_DESIGNER" | "VIEWER";
export const tandemVideoRoleSchema = z.enum([
  "CAPTAIN",
  "UPLOADER",
  "ARCHITECT",
  "VISUAL_EDITOR",
  "SOUND_DESIGNER",
  "MOTION_COLOR",
  "THUMBNAIL_DESIGNER",
  "VIEWER",
]);
