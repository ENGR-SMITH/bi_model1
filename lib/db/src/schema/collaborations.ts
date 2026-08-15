import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const collaborationSeedsTable = pgTable("collaboration_seeds", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  sourceProjectId: text("source_project_id").notNull(),
  sourceProjectTitle: text("source_project_title").notNull(),
  // Reference to the immutable Solo-project source this seed was frozen from:
  // the scene id and its revision at publish time. Respondents always see this
  // exact snapshot; editing the Solo project later never mutates the seed.
  sourceSceneId: text("source_scene_id"),
  sourceVersion: integer("source_version").notNull().default(1),
  seedText: text("seed_text").notNull(),
  unitType: text("unit_type").notNull(),
  protocol: text("protocol").notNull(),
  genre: text("genre").notNull(),
  tone: text("tone").notNull(),
  language: text("language").notNull(),
  plotConstraints: text("plot_constraints").notNull().default(""),
  desiredRole: text("desired_role").notNull(),
  visibility: text("visibility").notNull().default("SEED_AND_BRIEF"),
  respondentLimit: integer("respondent_limit").notNull().default(3),
  availability: text("availability").notNull().default("OPEN"),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const seedApplicationsTable = pgTable(
  "seed_applications",
  {
    id: text("id").primaryKey(),
    seedId: text("seed_id").notNull(),
    respondentId: text("respondent_id").notNull(),
    respondentName: text("respondent_name").notNull(),
    sourceProjectTitle: text("source_project_title").notNull(),
    sourceSeedText: text("source_seed_text").notNull(),
    draftText: text("draft_text").notNull().default(""),
    draftComments: text("draft_comments").notNull().default(""),
    status: text("status").notNull().default("DRAFT"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // A respondent may only hold ONE active application per seed. The route
  // enforces this in code (blocking DRAFT/SUBMITTED/UNDER_REVIEW/
  // ACCEPTED_PENDING_CONTRACT), so the index mirrors that rule: once a previous
  // application is DECLINED or otherwise resolved, reapplying is allowed. A
  // plain unique constraint would wrongly block reapplying after a decline.
  (table) => ({
    activeSeedRespondentUnique: uniqueIndex(
      "seed_application_active_seed_respondent_unique",
    )
      .on(table.seedId, table.respondentId)
      .where(
        sql`${table.status} in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED_PENDING_CONTRACT')`,
      ),
  }),
);

export const continuationSubmissionsTable = pgTable(
  "continuation_submissions",
  {
    id: text("id").primaryKey(),
    applicationId: text("application_id").notNull(),
    seedId: text("seed_id").notNull(),
    creatorId: text("creator_id").notNull(),
    respondentId: text("respondent_id").notNull(),
    respondentName: text("respondent_name").notNull(),
    sourceProjectTitle: text("source_project_title").notNull(),
    seedText: text("seed_text").notNull(),
    continuationText: text("continuation_text").notNull(),
    comments: text("comments").notNull().default(""),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("UNDER_REVIEW"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    applicationVersionUnique: unique("continuation_application_version_unique").on(
      table.applicationId,
      table.version,
    ),
  }),
);

export const collaborationProjectsTable = pgTable("collaboration_projects", {
  id: text("id").primaryKey(),
  seedId: text("seed_id").notNull(),
  title: text("title").notNull(),
  creatorId: text("creator_id").notNull(),
  creatorName: text("creator_name").notNull(),
  respondentId: text("respondent_id").notNull(),
  respondentName: text("respondent_name").notNull(),
  seedText: text("seed_text").notNull(),
  continuationText: text("continuation_text").notNull(),
  status: text("status").notNull().default("CONTRACT_PENDING"),
  contractVersion: integer("contract_version").notNull().default(1),
  creatorApproved: boolean("creator_approved").notNull().default(false),
  respondentApproved: boolean("respondent_approved").notNull().default(false),
  currentTurn: text("current_turn").notNull().default("CREATOR"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collaborationNotificationsTable = pgTable("collaboration_notifications", {
  id: text("id").primaryKey(),
  recipientId: text("recipient_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  deepLink: text("deep_link").notNull(),
  resourceId: text("resource_id"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCollaborationSeedSchema = createInsertSchema(collaborationSeedsTable);
export const insertSeedApplicationSchema = createInsertSchema(seedApplicationsTable);
export const insertContinuationSubmissionSchema = createInsertSchema(continuationSubmissionsTable);
export const insertCollaborationProjectSchema = createInsertSchema(collaborationProjectsTable);
export const insertCollaborationNotificationSchema = createInsertSchema(collaborationNotificationsTable);

export type CollaborationSeed = typeof collaborationSeedsTable.$inferSelect;
export type SeedApplication = typeof seedApplicationsTable.$inferSelect;
export type ContinuationSubmission = typeof continuationSubmissionsTable.$inferSelect;
export type CollaborationProject = typeof collaborationProjectsTable.$inferSelect;
export type CollaborationNotification = typeof collaborationNotificationsTable.$inferSelect;
export type CollaborationJson = Record<string, unknown> | unknown[];
export const collaborationJsonSchema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);