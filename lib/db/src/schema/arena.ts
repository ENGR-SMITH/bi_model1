import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Creator Den — Collaboration / Audition Arena (public contribution system).
//
// Captains post an OPEN role (VIDEO | AUDIO | SCRIPT | THUMBNAIL) for a
// channel project; signed-in creators browse the Arena, preview the project
// read-only (PREVIEW + TIMELINE) while a post is OPEN, and apply with a
// message + documents. The Captain accepts/rejects; acceptance adds the
// applicant as a project member holding that role and fills the post.
// Mirrors the plan in CREATOR-DEN-AUDITION-ARENA-PLAN.md (§6).
// ---------------------------------------------------------------------------

/** The four content roles a post can recruit for. */
export const arenaRoleSchema = z.enum(["VIDEO", "AUDIO", "SCRIPT", "THUMBNAIL"]);
export type ArenaRole = z.infer<typeof arenaRoleSchema>;

/** Post lifecycle: OPEN → FILLED (a hire landed) or CLOSED (Captain closed; may reopen). */
export const arenaPostStatusSchema = z.enum(["OPEN", "FILLED", "CLOSED"]);
export type ArenaPostStatus = z.infer<typeof arenaPostStatusSchema>;

/** Application lifecycle. WITHDRAWN is applicant-initiated; a resolved row is final. */
export const arenaApplicationStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "WITHDRAWN",
]);
export type ArenaApplicationStatus = z.infer<typeof arenaApplicationStatusSchema>;

// One open role on one channel project. A Captain (project owner, who owns the
// channel) posts it; the partial unique index guarantees a single OPEN post
// per (project, role) while FILLED/CLOSED rows do not block reopening.
export const tandemArenaPostsTable = pgTable(
  "tandem_arena_posts",
  {
    id: text("id").primaryKey(), // arena_…
    channelId: text("channel_id").notNull(), // → tandem_channels.id
    projectId: text("project_id").notNull(), // → tandem_video_projects.id
    role: text("role").notNull(), // VIDEO | AUDIO | SCRIPT | THUMBNAIL
    pitch: text("pitch").notNull(), // Captain's ask (zod: 10–2000 chars)
    // OPEN → FILLED | CLOSED
    status: text("status").notNull().default("OPEN"),
    postedBy: text("posted_by").notNull(), // Captain's Clerk user id
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    openProjectRoleUnique: uniqueIndex("tandem_arena_post_open_project_role_unique")
      .on(table.projectId, table.role)
      .where(sql`${table.status} = 'OPEN'`),
  }),
);

// One audition for a post. projectId + role are denormalized snapshots so the
// read-gate and the member-add on accept never need to re-join the post. The
// partial unique index keeps a single PENDING application per (post,
// applicant); a resolved row does not block the applicant applying again.
export const tandemArenaApplicationsTable = pgTable(
  "tandem_arena_applications",
  {
    id: text("id").primaryKey(), // arenaapp_…
    postId: text("post_id").notNull(), // → tandem_arena_posts.id
    projectId: text("project_id").notNull(), // denormalized from the post
    role: text("role").notNull(), // denormalized snapshot of the post's role
    applicantId: text("applicant_id").notNull(), // Clerk user id
    message: text("message").notNull(), // zod min 20 / max 2000
    // PENDING → ACCEPTED | REJECTED (Captain) or WITHDRAWN (applicant)
    status: text("status").notNull().default("PENDING"),
    decidedBy: text("decided_by"), // Captain's user id when decided
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pendingPostApplicantUnique: uniqueIndex(
      "tandem_arena_application_pending_post_applicant_unique",
    )
      .on(table.postId, table.applicantId)
      .where(sql`${table.status} = 'PENDING'`),
    postApplicantIdx: index("tandem_arena_application_post_applicant_idx").on(
      table.postId,
      table.applicantId,
    ),
  }),
);

// Supporting documents attached to an audition (≤3 files × ≤15 MB, allowlisted
// MIME types). Metadata only; bytes live in the server upload dir under
// `arena/<application_id>/` (multer/CV precedent in routes/account.ts).
export const tandemArenaApplicationFilesTable = pgTable(
  "tandem_arena_application_files",
  {
    id: text("id").primaryKey(), // arenafile_…
    applicationId: text("application_id").notNull(), // → tandem_arena_applications.id
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/octet-stream"),
    // bigint for parity with vault assets; the 15 MB cap fits a 64-bit int.
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    storageKey: text("storage_key").notNull(), // multer file name in uploadDir()/arena/<application_id>/
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    applicationIdx: index("tandem_arena_application_file_application_idx").on(
      table.applicationId,
    ),
  }),
);

// Role watch alerts: notify a user when a new OPEN post matches a role,
// optionally scoped to one channel (channelId NULL = that role everywhere).
// Postgres/SQLite treat NULLs as distinct in unique constraints, so a global
// watch (channelId NULL) can repeat under a naive unique — the route enforces
// at-most-one per (user, role, channel-or-global) before insert.
export const tandemArenaWatchesTable = pgTable(
  "tandem_arena_watches",
  {
    id: text("id").primaryKey(), // arenawatch_…
    userId: text("user_id").notNull(), // the watcher
    role: text("role").notNull(), // VIDEO | AUDIO | SCRIPT | THUMBNAIL
    channelId: text("channel_id"), // nullable: one channel or the whole Arena
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("tandem_arena_watch_user_idx").on(table.userId),
  }),
);

// Mutual work reviews after a hire. Created only for an ACCEPTED application:
// the Captain may review the hired applicant and the applicant may review the
// Captain, once each per hire (unique per application + reviewer). Reviews are
// public profile data rendered on the reviewee's Creator Den profile.
export const tandemArenaReviewsTable = pgTable(
  "tandem_arena_reviews",
  {
    id: text("id").primaryKey(), // arenareview_…
    applicationId: text("application_id").notNull(), // → the ACCEPTED application
    projectId: text("project_id").notNull(), // snapshot from the application
    role: text("role").notNull(), // snapshot from the application
    reviewerId: text("reviewer_id").notNull(), // Captain or hired applicant
    revieweeId: text("reviewee_id").notNull(),
    rating: integer("rating").notNull(), // 1–5
    note: text("note").notNull(), // short public line (zod: max 500)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    applicationReviewerUnique: unique(
      "tandem_arena_review_application_reviewer_unique",
    ).on(table.applicationId, table.reviewerId),
  }),
);

// Per-Captain applicant blocks (anti-spam). Blocking stops the user from
// applying to any post by that Captain (403 at apply) and never mutates
// existing application statuses. No global moderation in v1.
export const tandemArenaBlocksTable = pgTable(
  "tandem_arena_blocks",
  {
    id: text("id").primaryKey(), // arenablock_…
    captainId: text("captain_id").notNull(), // the project/post owner who blocks
    applicantId: text("applicant_id").notNull(), // the blocked user
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    captainApplicantUnique: unique("tandem_arena_block_captain_applicant_unique").on(
      table.captainId,
      table.applicantId,
    ),
  }),
);

export const insertTandemArenaPostSchema = createInsertSchema(tandemArenaPostsTable);
export const insertTandemArenaApplicationSchema = createInsertSchema(
  tandemArenaApplicationsTable,
);
export const insertTandemArenaApplicationFileSchema = createInsertSchema(
  tandemArenaApplicationFilesTable,
);
export const insertTandemArenaWatchSchema = createInsertSchema(tandemArenaWatchesTable);
export const insertTandemArenaReviewSchema = createInsertSchema(tandemArenaReviewsTable);
export const insertTandemArenaBlockSchema = createInsertSchema(tandemArenaBlocksTable);

export type TandemArenaPost = typeof tandemArenaPostsTable.$inferSelect;
export type TandemArenaApplication = typeof tandemArenaApplicationsTable.$inferSelect;
export type TandemArenaApplicationFile = typeof tandemArenaApplicationFilesTable.$inferSelect;
export type TandemArenaWatch = typeof tandemArenaWatchesTable.$inferSelect;
export type TandemArenaReview = typeof tandemArenaReviewsTable.$inferSelect;
export type TandemArenaBlock = typeof tandemArenaBlocksTable.$inferSelect;
