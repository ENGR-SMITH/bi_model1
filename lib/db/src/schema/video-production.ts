import { createInsertSchema } from "drizzle-zod";
import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Content Creators — M1: the processing pipeline (proxies + transcripts), the
// per-leg timeline with Git-style snapshots, submissions, timecode comments,
// and the background job queue. All tables are prefixed `tandem_`.
// ---------------------------------------------------------------------------

// Every physical artifact produced for an asset: ORIGINAL, PROXY, TRANSCRIPT,
// AUDIO_STEM, THUMBNAIL, RENDER... The original is recorded at upload; workers
// add the rest. Versioned like Git — raw upload is v0.
export const tandemVideoAssetFilesTable = pgTable("tandem_video_asset_files", {
  id: text("id").primaryKey(),
  // Nullable — project-scoped artifacts (e.g. INTERCHANGE checkout bundles)
  // are not anchored to a single asset.
  assetId: text("asset_id"),
  kind: text("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  // e.g. { width, height, fps, durationMs, model, degraded }
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tandemVideoTranscriptsTable = pgTable(
  "tandem_video_transcripts",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    language: text("language").notNull().default("en"),
    model: text("model").notNull().default("faster-whisper"),
    // READY | DEMO | UNAVAILABLE
    status: text("status").notNull().default("READY"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    assetUnique: unique("tandem_video_transcript_asset_unique").on(table.assetId),
  }),
);

export const tandemVideoTranscriptSegmentsTable = pgTable(
  "tandem_video_transcript_segments",
  {
    id: text("id").primaryKey(),
    transcriptId: text("transcript_id").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    text: text("text").notNull(),
    speaker: text("speaker"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// One timeline per leg (SELECTS | CUT | SOUND | FINISH). The working document
// is the latest snapshot; every save creates a new TimelineVersion (Git-style).
export const tandemVideoTimelinesTable = pgTable(
  "tandem_video_timelines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    leg: text("leg").notNull(),
    currentVersionId: text("current_version_id"),
    status: text("status").notNull().default("DRAFT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectLegUnique: unique("tandem_video_timeline_project_leg").on(
      table.projectId,
      table.leg,
    ),
  }),
);

export const tandemVideoTimelineVersionsTable = pgTable(
  "tandem_video_timeline_versions",
  {
    id: text("id").primaryKey(),
    timelineId: text("timeline_id").notNull(),
    version: integer("version").notNull(),
    // Canonical edit document:
    // { clips: [{id, assetId, inMs, outMs}], sceneBlocks: [{id, type, startMs, endMs}],
    //   textOverlays: [{id, text, startMs, endMs}], markers: [{id, label, timeMs}] }
    snapshot: jsonb("snapshot").notNull(),
    message: text("message").notNull().default(""),
    createdById: text("created_by_id").notNull(),
    parentVersionId: text("parent_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    timelineVersionUnique: unique("tandem_video_timeline_version_unique").on(
      table.timelineId,
      table.version,
    ),
  }),
);

// A leg's deliverable. Submit pins the current snapshot; the Captain approves
// or rejects. DRAFT → SUBMITTED → APPROVED / REJECTED.
export const tandemVideoSubmissionsTable = pgTable("tandem_video_submissions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  leg: text("leg").notNull(),
  timelineVersionId: text("timeline_version_id").notNull(),
  status: text("status").notNull().default("DRAFT"),
  note: text("note").notNull().default(""),
  submittedById: text("submitted_by_id").notNull(),
  decidedById: text("decided_by_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Comments + annotations ("the lighting shift at 02:14 is jarring — can we
// grade this?"). One primitive serves both timecode notes and spatial pins:
// `geometry` (normalized x/y/w/h) turns a comment into a Frame.io-style pin
// or highlight drawn over the frame; `kind` distinguishes TIMECODE notes from
// PIN / HIGHLIGHT / MARK annotations; `color` + `label` identify the reviewer
// on a shared canvas; `submissionId` / `timelineVersionId` scope the comment
// to a specific review (PR) or version.
export const tandemVideoCommentsTable = pgTable("tandem_video_comments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  leg: text("leg"),
  assetId: text("asset_id"),
  timecodeMs: integer("timecode_ms"),
  body: text("body").notNull(),
  authorId: text("author_id").notNull(),
  parentId: text("parent_id"),
  // Normalized 0..1: { x, y, w?, h? } — null = timecode-only note.
  geometry: jsonb("geometry"),
  // TIMECODE | PIN | HIGHLIGHT | MARK
  kind: text("kind").notNull().default("TIMECODE"),
  // Reviewer's unique color / swatch on the annotation canvas.
  color: text("color"),
  // Short identifier, e.g. "A", "1", "FIX".
  label: text("label"),
  // Scope the comment to a submission (PR) or timeline version.
  submissionId: text("submission_id"),
  timelineVersionId: text("timeline_version_id"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Multi-camera waveform sync pairs (M2). The Visual Editor pairs a primary
// camera with a secondary angle (or dual-system audio); the sync worker
// cross-correlates the waveforms and stores the offset in ms here.
export const tandemVideoSyncsTable = pgTable(
  "tandem_video_syncs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    primaryAssetId: text("primary_asset_id").notNull(),
    targetAssetId: text("target_asset_id").notNull(),
    // Positive = target leads the primary; negative = target lags.
    offsetMs: integer("offset_ms").notNull().default(0),
    // WAVEFORM (real cross-correlation) | DEMO (no ffmpeg installed)
    method: text("method").notNull().default("DEMO"),
    status: text("status").notNull().default("SYNCED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    syncPairUnique: unique("tandem_video_sync_pair_unique").on(
      table.primaryAssetId,
      table.targetAssetId,
    ),
  }),
);

// Viral reference import (M4). A REFERENCE asset is transcribed and its
// pacing structure extracted (scene changes + transcript section boundaries)
// so the Architect can see the reference's beats side-by-side while cutting.
export const tandemVideoReferencesTable = pgTable(
  "tandem_video_references",
  {
    id: text("id").primaryKey(),
    assetId: text("asset_id").notNull(),
    // QUEUED → READY | FAILED; DEMO when no whisper/ffmpeg installed.
    status: text("status").notNull().default("QUEUED"),
    // { sections: [{label, startMs, endMs}], totalMs, source: 'WHISPER+FFMPEG' | 'DEMO' }
    pacing: jsonb("pacing"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    referenceAssetUnique: unique("tandem_video_reference_asset_unique").on(table.assetId),
  }),
);

// Selective temporary downloads (M4). The Captain grants a member access to a
// specific file with a reason + expiry; the grant bypasses the Lock while it's
// active. Revoking is instant and logged alongside the download audit trail.
export const tandemVideoGrantsTable = pgTable("tandem_video_grants", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  fileId: text("file_id").notNull(),
  memberId: text("member_id").notNull(),
  reason: text("reason").notNull().default(""),
  grantedById: text("granted_by_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Tandem notifications (M4) — mirrors the parent's collaboration notifications
// table so the room can reuse the same inbox conventions.
export const tandemVideoNotificationsTable = pgTable("tandem_video_notifications", {
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

// The Lock release audit trail (M3). Every time a file is downloaded after
// the Captain releases the lock, a row is written here — who, what, when.
export const tandemVideoDownloadsTable = pgTable("tandem_video_downloads", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  fileId: text("file_id").notNull(),
  fileName: text("file_name").notNull(),
  memberId: text("member_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Background jobs for the processing pipeline. Runs in-process today
// (Postgres-backed queue); swap for BullMQ/Redis + Docker workers later —
// the row contract stays the same. `params` carries per-job inputs that are
// not part of the row contract (e.g. { targetAssetId } for SYNC, { format }
// for RENDER).
export const tandemVideoJobsTable = pgTable("tandem_video_jobs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  // Nullable — project/leg-scoped jobs (e.g. EXPORT_BUNDLE checkout) have no
  // anchor asset.
  assetId: text("asset_id"),
  type: text("type").notNull(),
  // QUEUED → RUNNING → SUCCEEDED | FAILED
  status: text("status").notNull().default("QUEUED"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  params: jsonb("params"),
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const insertTandemVideoAssetFileSchema = createInsertSchema(tandemVideoAssetFilesTable);
export const insertTandemVideoTranscriptSchema = createInsertSchema(tandemVideoTranscriptsTable);
export const insertTandemVideoTranscriptSegmentSchema = createInsertSchema(tandemVideoTranscriptSegmentsTable);
export const insertTandemVideoTimelineSchema = createInsertSchema(tandemVideoTimelinesTable);
export const insertTandemVideoTimelineVersionSchema = createInsertSchema(tandemVideoTimelineVersionsTable);
export const insertTandemVideoSubmissionSchema = createInsertSchema(tandemVideoSubmissionsTable);
export const insertTandemVideoCommentSchema = createInsertSchema(tandemVideoCommentsTable);
export const insertTandemVideoJobSchema = createInsertSchema(tandemVideoJobsTable);
export const insertTandemVideoSyncSchema = createInsertSchema(tandemVideoSyncsTable);
export const insertTandemVideoDownloadSchema = createInsertSchema(tandemVideoDownloadsTable);
export const insertTandemVideoReferenceSchema = createInsertSchema(tandemVideoReferencesTable);
export const insertTandemVideoGrantSchema = createInsertSchema(tandemVideoGrantsTable);
export const insertTandemVideoNotificationSchema = createInsertSchema(tandemVideoNotificationsTable);

export type TandemVideoAssetFile = typeof tandemVideoAssetFilesTable.$inferSelect;
export type TandemVideoSync = typeof tandemVideoSyncsTable.$inferSelect;
export type TandemVideoDownload = typeof tandemVideoDownloadsTable.$inferSelect;
export type TandemVideoReference = typeof tandemVideoReferencesTable.$inferSelect;
export type TandemVideoGrant = typeof tandemVideoGrantsTable.$inferSelect;
export type TandemVideoNotification = typeof tandemVideoNotificationsTable.$inferSelect;
export type TandemVideoTranscript = typeof tandemVideoTranscriptsTable.$inferSelect;
export type TandemVideoTranscriptSegment = typeof tandemVideoTranscriptSegmentsTable.$inferSelect;
export type TandemVideoTimeline = typeof tandemVideoTimelinesTable.$inferSelect;
export type TandemVideoTimelineVersion = typeof tandemVideoTimelineVersionsTable.$inferSelect;
export type TandemVideoSubmission = typeof tandemVideoSubmissionsTable.$inferSelect;
export type TandemVideoComment = typeof tandemVideoCommentsTable.$inferSelect;
export type TandemVideoJob = typeof tandemVideoJobsTable.$inferSelect;

export const VIDEO_LEGS = ["SELECTS", "CUT", "SOUND", "FINISH", "THUMBNAIL"] as const;
export type VideoLeg = (typeof VIDEO_LEGS)[number];
export const VIDEO_JOB_TYPES = [
  "PROXY",
  "TRANSCRIBE",
  "SYNC",
  "RENDER",
  "AUDIO",
  "EXPORT",
  "THUMBNAIL",
  "REFERENCE_ANALYZE",
  "INTERCHANGE",
  "EXPORT_BUNDLE",
] as const;
export type VideoJobType = (typeof VIDEO_JOB_TYPES)[number];
