import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const require = createRequire(import.meta.url);

// Mirrors the pg collaboration tables (lib/db/src/schema/*) using sqlite so the
// real collaboration router and oracle lib can run against an in-memory store.
// Column names/types are kept identical to the production schema.
export const collaborationSeedsTable = sqliteTable("collaboration_seeds", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  creatorName: text("creator_name"),
  sourceProjectId: text("source_project_id").notNull(),
  sourceProjectTitle: text("source_project_title").notNull(),
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
  // Mirrors pg jsonb: a text column with JSON mode so objects round-trip.
  projectDocument: text("project_document", { mode: "json" }),
  availability: text("availability").notNull().default("OPEN"),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  closedAt: integer("closed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const seedApplicationsTable = sqliteTable(
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
    projectDocument: text("project_document", { mode: "json" }),
    status: text("status").notNull().default("DRAFT"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    // Mirrors the pg schema: only one ACTIVE application per (seed, respondent);
    // a declined/resolved application does not block reapplying.
    activeSeedRespondentUnique: uniqueIndex("seed_application_active_seed_respondent_unique")
      .on(table.seedId, table.respondentId)
      .where(sql`${table.status} in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED_PENDING_CONTRACT')`),
  }),
);

export const continuationSubmissionsTable = sqliteTable(
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
    projectDocument: text("project_document", { mode: "json" }),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("UNDER_REVIEW"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    applicationVersionUnique: unique("continuation_application_version_unique").on(table.applicationId, table.version),
  }),
);

export const collaborationProjectsTable = sqliteTable("collaboration_projects", {
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
  creatorApproved: integer("creator_approved", { mode: "boolean" }).notNull().default(false),
  respondentApproved: integer("respondent_approved", { mode: "boolean" }).notNull().default(false),
  currentTurn: text("current_turn").notNull().default("CREATOR"),
  document: text("document", { mode: "json" }),
  lockedAt: integer("locked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const collaborationNotificationsTable = sqliteTable("collaboration_notifications", {
  id: text("id").primaryKey(),
  recipientId: text("recipient_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  deepLink: text("deep_link").notNull(),
  resourceId: text("resource_id"),
  readAt: integer("read_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const collaborationThreadsTable = sqliteTable(
  "collaboration_threads",
  {
    id: text("id").primaryKey(),
    continuationId: text("continuation_id").notNull(),
    creatorId: text("creator_id").notNull(),
    respondentId: text("respondent_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    continuationUnique: unique("collaboration_thread_continuation_unique").on(table.continuationId),
  }),
);

export const collaborationMessagesTable = sqliteTable("collaboration_messages", {
  id: text("id").primaryKey(),
  threadId: text("thread_id").notNull(),
  senderId: text("sender_id").notNull(),
  body: text("body").notNull(),
  audioUrl: text("audio_url"),
  audioName: text("audio_name"),
  audioDurationMs: integer("audio_duration_ms"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const continuationAnnotationsTable = sqliteTable("continuation_annotations", {
  id: text("id").primaryKey(),
  continuationId: text("continuation_id").notNull(),
  authorId: text("author_id").notNull(),
  rangeStart: integer("range_start").notNull(),
  rangeEnd: integer("range_end").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const collaborationWorkBlocksTable = sqliteTable(
  "collaboration_work_blocks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("DRAFT"),
    parentBlockId: text("parent_block_id"),
    turnOrder: integer("turn_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    projectKindUnique: unique("collaboration_work_block_project_kind").on(table.projectId, table.kind, table.ownerId),
  }),
);

export const collaborationStoryBibleEntriesTable = sqliteTable("collaboration_story_bible_entries", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  content: text("content").notNull(),
  ownerId: text("owner_id").notNull(),
  shared: integer("shared", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const collaborationActivityEventsTable = sqliteTable("collaboration_activity_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  seedId: text("seed_id"),
  actorId: text("actor_id").notNull(),
  eventType: text("event_type").notNull(),
  summary: text("summary").notNull(),
  resourceId: text("resource_id"),
  leg: text("leg"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const collaborationGenealogyTable = sqliteTable("collaboration_genealogy", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  blockId: text("block_id"),
  parentBlockId: text("parent_block_id"),
  contributorId: text("contributor_id").notNull(),
  contributorName: text("contributor_name").notNull(),
  role: text("role").notNull(),
  kind: text("kind").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoProjectsTable = sqliteTable("tandem_video_projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("VAULT"),
  visibility: text("visibility").notNull().default("PRIVATE"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoFollowsTable = sqliteTable(
  "tandem_video_follows",
  {
    id: text("id").primaryKey(),
    followerId: text("follower_id").notNull(),
    followingId: text("following_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    followerFollowingUnique: unique("tandem_video_follow_follower_following").on(table.followerId, table.followingId),
  }),
);

export const tandemVideoMembersTable = sqliteTable(
  "tandem_video_members",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    userId: text("user_id").notNull(),
    // JSON array of role strings, e.g. ["VIDEO", "THUMBNAIL"].
    roles: text("roles", { mode: "json" }).notNull().default([]),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    projectUserUnique: unique("tandem_video_member_project_user").on(table.projectId, table.userId),
  }),
);

export const tandemVideoAssetsTable = sqliteTable("tandem_video_assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  uploaderId: text("uploader_id").notNull(),
  kind: text("kind").notNull().default("RAW_VIDEO"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  durationMs: integer("duration_ms"),
  storageKey: text("storage_key").notNull(),
  contentHash: text("content_hash"),
  status: text("status").notNull().default("UPLOADED"),
  version: integer("version").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoAssetFilesTable = sqliteTable("tandem_video_asset_files", {
  id: text("id").primaryKey(),
  assetId: text("asset_id"),
  kind: text("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  contentHash: text("content_hash"),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoTranscriptsTable = sqliteTable(
  "tandem_video_transcripts",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    language: text("language").notNull().default("en"),
    model: text("model").notNull().default("faster-whisper"),
    status: text("status").notNull().default("READY"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    assetUnique: unique("tandem_video_transcript_asset_unique").on(table.assetId),
  }),
);

export const tandemVideoTranscriptSegmentsTable = sqliteTable("tandem_video_transcript_segments", {
  id: text("id").primaryKey(),
  transcriptId: text("transcript_id").notNull(),
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  text: text("text").notNull(),
  speaker: text("speaker"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoTimelinesTable = sqliteTable(
  "tandem_video_timelines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    leg: text("leg").notNull(),
    currentVersionId: text("current_version_id"),
    status: text("status").notNull().default("DRAFT"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    projectLegUnique: unique("tandem_video_timeline_project_leg").on(table.projectId, table.leg),
  }),
);

export const tandemVideoTimelineVersionsTable = sqliteTable(
  "tandem_video_timeline_versions",
  {
    id: text("id").primaryKey(),
    timelineId: text("timeline_id").notNull(),
    version: integer("version").notNull(),
    snapshot: text("snapshot", { mode: "json" }).notNull(),
    message: text("message").notNull().default(""),
    createdById: text("created_by_id").notNull(),
    parentVersionId: text("parent_version_id"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    timelineVersionUnique: unique("tandem_video_timeline_version_unique").on(table.timelineId, table.version),
  }),
);

export const tandemVideoSubmissionsTable = sqliteTable("tandem_video_submissions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  leg: text("leg").notNull(),
  timelineVersionId: text("timeline_version_id").notNull(),
  status: text("status").notNull().default("DRAFT"),
  note: text("note").notNull().default(""),
  decisionNote: text("decision_note"),
  submittedById: text("submitted_by_id").notNull(),
  decidedById: text("decided_by_id"),
  decidedAt: integer("decided_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoCommentsTable = sqliteTable("tandem_video_comments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  leg: text("leg"),
  assetId: text("asset_id"),
  timecodeMs: integer("timecode_ms"),
  body: text("body").notNull(),
  authorId: text("author_id").notNull(),
  parentId: text("parent_id"),
  geometry: text("geometry", { mode: "json" }),
  kind: text("kind").notNull().default("TIMECODE"),
  color: text("color"),
  label: text("label"),
  submissionId: text("submission_id"),
  timelineVersionId: text("timeline_version_id"),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoChatMessagesTable = sqliteTable("tandem_video_chat_messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  authorId: text("author_id").notNull(),
  body: text("body").notNull(),
  audioUrl: text("audio_url"),
  audioName: text("audio_name"),
  audioDurationMs: integer("audio_duration_ms"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoReferencesTable = sqliteTable(
  "tandem_video_references",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    status: text("status").notNull().default("QUEUED"),
    pacing: text("pacing", { mode: "json" }),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    referenceAssetUnique: unique("tandem_video_reference_asset_unique").on(table.assetId),
  }),
);

export const tandemVideoGrantsTable = sqliteTable("tandem_video_grants", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  // JSON array of role strings, e.g. ["VIDEO", "AUDIO"] or ["ALL"].
  roles: text("roles", { mode: "json" }).notNull().default([]),
  memberId: text("member_id").notNull(),
  reason: text("reason").notNull().default(""),
  grantedById: text("granted_by_id").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoNotificationsTable = sqliteTable("tandem_video_notifications", {
  id: text("id").primaryKey(),
  recipientId: text("recipient_id").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  deepLink: text("deep_link").notNull(),
  resourceId: text("resource_id"),
  readAt: integer("read_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemAccountQuotasTable = sqliteTable("tandem_account_quotas", {
  userId: text("user_id").primaryKey(),
  storageLimitBytes: integer("storage_limit_bytes").notNull(),
  projectLimit: integer("project_limit").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemTicketsTable = sqliteTable("tandem_tickets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  category: text("category").notNull(),
  priceUsd: integer("price_usd").notNull(),
  promoCode: text("promo_code"),
  cardLast4: text("card_last_4").notNull(),
  purchasedAt: integer("purchased_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemPromoCodesTable = sqliteTable("tandem_promo_codes", {
  code: text("code").primaryKey(),
  kind: text("kind").notNull(),
  value: integer("value").notNull().default(0),
  maxUses: integer("max_uses").notNull().default(0),
  uses: integer("uses").notNull().default(0),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemUserCvsTable = sqliteTable("tandem_user_cvs", {
  userId: text("user_id").primaryKey(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  storageKey: text("storage_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoDownloadsTable = sqliteTable("tandem_video_downloads", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  fileId: text("file_id").notNull(),
  fileName: text("file_name").notNull(),
  memberId: text("member_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const tandemVideoSyncsTable = sqliteTable(
  "tandem_video_syncs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    primaryAssetId: text("primary_asset_id").notNull(),
    targetAssetId: text("target_asset_id").notNull(),
    offsetMs: integer("offset_ms").notNull().default(0),
    method: text("method").notNull().default("DEMO"),
    status: text("status").notNull().default("SYNCED"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    syncPairUnique: unique("tandem_video_sync_pair_unique").on(table.primaryAssetId, table.targetAssetId),
  }),
);

export const tandemVideoJobsTable = sqliteTable("tandem_video_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  assetId: text("asset_id"),
  type: text("type").notNull(),
  status: text("status").notNull().default("QUEUED"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  params: text("params", { mode: "json" }),
  result: text("result", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  startedAt: integer("started_at", { mode: "timestamp" }),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

export const oracleProvidersTable = sqliteTable("oracle_providers", {
  id: text("id").primaryKey(),
  baseUrl: text("base_url").notNull().default(""),
  modelId: text("model_id"),
  apiKeyCiphertext: text("api_key_ciphertext"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(1),
  status: text("status").notNull().default("not_configured"),
  lastError: text("last_error"),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
  lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
  lastSuccessModelId: text("last_success_model_id"),
  cooldownUntil: integer("cooldown_until", { mode: "timestamp" }),
});

export const oracleHealthEventsTable = sqliteTable("oracle_health_events", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id"),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  responseStatus: integer("response_status"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export async function buildInMemoryDb() {
  const SQL = await initSqlJs({
    locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm"),
  });
  const database = new SQL.Database();
  database.run("PRAGMA foreign_keys = ON");
  database.run(`
    CREATE TABLE collaboration_seeds (
      id TEXT PRIMARY KEY NOT NULL, creator_id TEXT NOT NULL,
      creator_name TEXT,
      source_project_id TEXT NOT NULL, source_project_title TEXT NOT NULL,
      source_scene_id TEXT, source_version INTEGER NOT NULL DEFAULT 1,
      seed_text TEXT NOT NULL, unit_type TEXT NOT NULL, protocol TEXT NOT NULL,
      genre TEXT NOT NULL, tone TEXT NOT NULL, language TEXT NOT NULL,
      plot_constraints TEXT NOT NULL DEFAULT '', desired_role TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'SEED_AND_BRIEF',
      respondent_limit INTEGER NOT NULL DEFAULT 3,
      project_document TEXT,
      availability TEXT NOT NULL DEFAULT 'OPEN',
      published_at INTEGER NOT NULL, closed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE seed_applications (
      id TEXT PRIMARY KEY NOT NULL, seed_id TEXT NOT NULL,
      respondent_id TEXT NOT NULL, respondent_name TEXT NOT NULL,
      source_project_title TEXT NOT NULL, source_seed_text TEXT NOT NULL,
      draft_text TEXT NOT NULL DEFAULT '', draft_comments TEXT NOT NULL DEFAULT '',
      project_document TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT', submitted_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX seed_application_active_seed_respondent_unique
      ON seed_applications (seed_id, respondent_id)
      WHERE status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','ACCEPTED_PENDING_CONTRACT');
    CREATE TABLE continuation_submissions (
      id TEXT PRIMARY KEY NOT NULL, application_id TEXT NOT NULL,
      seed_id TEXT NOT NULL, creator_id TEXT NOT NULL, respondent_id TEXT NOT NULL,
      respondent_name TEXT NOT NULL, source_project_title TEXT NOT NULL,
      seed_text TEXT NOT NULL, continuation_text TEXT NOT NULL,
      comments TEXT NOT NULL DEFAULT '', project_document TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'UNDER_REVIEW',
      submitted_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE (application_id, version)
    );
    CREATE TABLE collaboration_projects (
      id TEXT PRIMARY KEY NOT NULL, seed_id TEXT NOT NULL, title TEXT NOT NULL,
      creator_id TEXT NOT NULL, creator_name TEXT NOT NULL,
      respondent_id TEXT NOT NULL, respondent_name TEXT NOT NULL,
      seed_text TEXT NOT NULL, continuation_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONTRACT_PENDING',
      contract_version INTEGER NOT NULL DEFAULT 1,
      creator_approved INTEGER NOT NULL DEFAULT 0,
      respondent_approved INTEGER NOT NULL DEFAULT 0,
      current_turn TEXT NOT NULL DEFAULT 'CREATOR', document TEXT, locked_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE collaboration_notifications (
      id TEXT PRIMARY KEY NOT NULL, recipient_id TEXT NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      deep_link TEXT NOT NULL, resource_id TEXT, read_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE collaboration_threads (
      id TEXT PRIMARY KEY NOT NULL, continuation_id TEXT NOT NULL,
      creator_id TEXT NOT NULL, respondent_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (continuation_id)
    );
    CREATE TABLE collaboration_messages (
      id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL,
      sender_id TEXT NOT NULL, body TEXT NOT NULL,
      audio_url TEXT, audio_name TEXT, audio_duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE continuation_annotations (
      id TEXT PRIMARY KEY NOT NULL, continuation_id TEXT NOT NULL,
      author_id TEXT NOT NULL, range_start INTEGER NOT NULL,
      range_end INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE collaboration_work_blocks (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      owner_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', parent_block_id TEXT,
      turn_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (project_id, kind, owner_id)
    );
    CREATE TABLE collaboration_story_bible_entries (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      kind TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL,
      owner_id TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE collaboration_activity_events (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT, seed_id TEXT,
      actor_id TEXT NOT NULL, event_type TEXT NOT NULL, summary TEXT NOT NULL,
      resource_id TEXT, leg TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE collaboration_genealogy (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      block_id TEXT, parent_block_id TEXT,
      contributor_id TEXT NOT NULL, contributor_name TEXT NOT NULL,
      role TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE oracle_providers (
      id TEXT PRIMARY KEY NOT NULL, base_url TEXT NOT NULL DEFAULT '',
      model_id TEXT, api_key_ciphertext TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'not_configured', last_error TEXT,
      last_checked_at INTEGER, last_success_at INTEGER,
      last_success_model_id TEXT, cooldown_until INTEGER
    );
    CREATE TABLE oracle_health_events (
      id TEXT PRIMARY KEY NOT NULL, provider_id TEXT NOT NULL, model_id TEXT,
      event_type TEXT NOT NULL, status TEXT NOT NULL, response_status INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_projects (
      id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL,
      name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'VAULT',
      visibility TEXT NOT NULL DEFAULT 'PRIVATE',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_follows (
      id TEXT PRIMARY KEY NOT NULL, follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE (follower_id, following_id)
    );
    CREATE TABLE tandem_video_members (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      user_id TEXT NOT NULL, roles TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'ACTIVE', created_at INTEGER NOT NULL,
      UNIQUE (project_id, user_id)
    );
    CREATE TABLE tandem_video_assets (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      uploader_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'RAW_VIDEO',
      file_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER,
      storage_key TEXT NOT NULL, content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'UPLOADED',
      version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_asset_files (
      id TEXT PRIMARY KEY NOT NULL, asset_id TEXT,
      kind TEXT NOT NULL, storage_key TEXT NOT NULL, content_hash TEXT,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0, metadata TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_transcripts (
      id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      model TEXT NOT NULL DEFAULT 'faster-whisper',
      status TEXT NOT NULL DEFAULT 'READY',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (asset_id)
    );
    CREATE TABLE tandem_video_transcript_segments (
      id TEXT PRIMARY KEY NOT NULL, transcript_id TEXT NOT NULL,
      start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL,
      text TEXT NOT NULL, speaker TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_timelines (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      leg TEXT NOT NULL, current_version_id TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (project_id, leg)
    );
    CREATE TABLE tandem_video_timeline_versions (
      id TEXT PRIMARY KEY NOT NULL, timeline_id TEXT NOT NULL,
      version INTEGER NOT NULL, snapshot TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '', created_by_id TEXT NOT NULL,
      parent_version_id TEXT, created_at INTEGER NOT NULL,
      UNIQUE (timeline_id, version)
    );
    CREATE TABLE tandem_video_submissions (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      leg TEXT NOT NULL, timeline_version_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', note TEXT NOT NULL DEFAULT '',
      submitted_by_id TEXT NOT NULL, decided_by_id TEXT,
      decided_at INTEGER, decision_note TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_comments (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      leg TEXT, asset_id TEXT, timecode_ms INTEGER, body TEXT NOT NULL,
      author_id TEXT NOT NULL, parent_id TEXT,
      geometry TEXT, kind TEXT NOT NULL DEFAULT 'TIMECODE', color TEXT,
      label TEXT, submission_id TEXT, timeline_version_id TEXT,
      resolved_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_jobs (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      asset_id TEXT, type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED', attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT, params TEXT, result TEXT,
      created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
    );
    CREATE TABLE tandem_video_syncs (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      primary_asset_id TEXT NOT NULL, target_asset_id TEXT NOT NULL,
      offset_ms INTEGER NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'DEMO', status TEXT NOT NULL DEFAULT 'SYNCED',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (primary_asset_id, target_asset_id)
    );
    CREATE TABLE tandem_video_downloads (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      file_id TEXT NOT NULL, file_name TEXT NOT NULL,
      member_id TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_references (
      id TEXT PRIMARY KEY NOT NULL, asset_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED', pacing TEXT,
      error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (asset_id)
    );
    CREATE TABLE tandem_video_grants (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      roles TEXT NOT NULL DEFAULT '[]', member_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '', granted_by_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_notifications (
      id TEXT PRIMARY KEY NOT NULL, recipient_id TEXT NOT NULL,
      category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      deep_link TEXT NOT NULL, resource_id TEXT, read_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_tickets (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL,
      category TEXT NOT NULL, price_usd INTEGER NOT NULL,
      promo_code TEXT, card_last_4 TEXT NOT NULL,
      purchased_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_promo_codes (
      code TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0, max_uses INTEGER NOT NULL DEFAULT 0,
      uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_account_quotas (
      user_id TEXT PRIMARY KEY NOT NULL,
      storage_limit_bytes INTEGER NOT NULL,
      project_limit INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_user_cvs (
      user_id TEXT PRIMARY KEY NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE tandem_video_chat_messages (
      id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL,
      author_id TEXT NOT NULL, body TEXT NOT NULL,
      audio_url TEXT, audio_name TEXT, audio_duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(database);

  // drizzle's sql-js driver commits synchronously without awaiting async
  // transaction callbacks; patch this instance so the router's `async (tx)`
  // transactions (e.g. acceptance/selection) commit only after the callback
  // settles, matching the pg driver's behavior in production.
  const session = (db as any).session;
  let capturedTx: any = null;
  session.transaction((tx: any) => {
    capturedTx = tx;
  });
  const TxClass = capturedTx.constructor;
  (db as any).transaction = async function transaction(callback: (tx: any) => Promise<unknown>) {
    const tx = new TxClass("sync", session.dialect, session, session.schema);
    tx.run(sql.raw("begin"));
    try {
      const result = await callback(tx);
      tx.run(sql.raw("commit"));
      return result;
    } catch (error) {
      tx.run(sql.raw("rollback"));
      throw error;
    }
  };
  const tables = {
    collaborationSeedsTable,
    seedApplicationsTable,
    continuationSubmissionsTable,
    collaborationProjectsTable,
    collaborationNotificationsTable,
    collaborationThreadsTable,
    collaborationMessagesTable,
    continuationAnnotationsTable,
    collaborationWorkBlocksTable,
    collaborationStoryBibleEntriesTable,
    collaborationActivityEventsTable,
    collaborationGenealogyTable,
    oracleProvidersTable,
    oracleHealthEventsTable,
    tandemVideoProjectsTable,
    tandemVideoFollowsTable,
    tandemVideoMembersTable,
    tandemVideoAssetsTable,
    tandemVideoAssetFilesTable,
    tandemVideoTranscriptsTable,
    tandemVideoTranscriptSegmentsTable,
    tandemVideoTimelinesTable,
    tandemVideoTimelineVersionsTable,
    tandemVideoSubmissionsTable,
    tandemVideoCommentsTable,
    tandemVideoJobsTable,
    tandemVideoSyncsTable,
    tandemVideoDownloadsTable,
    tandemVideoReferencesTable,
    tandemVideoGrantsTable,
    tandemVideoNotificationsTable,
    tandemVideoChatMessagesTable,
    tandemAccountQuotasTable,
    tandemUserCvsTable,
    tandemTicketsTable,
    tandemPromoCodesTable,
  };
  return { db, tables, exports: { db, ...tables } };
}
