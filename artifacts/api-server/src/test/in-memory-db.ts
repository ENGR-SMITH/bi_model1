import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

const require = createRequire(import.meta.url);

// Mirrors the pg collaboration tables (lib/db/src/schema/*) using sqlite so the
// real collaboration router and oracle lib can run against an in-memory store.
// Column names/types are kept identical to the production schema.
export const collaborationSeedsTable = sqliteTable("collaboration_seeds", {
  id: text("id").primaryKey(),
  creatorId: text("creator_id").notNull(),
  sourceProjectId: text("source_project_id").notNull(),
  sourceProjectTitle: text("source_project_title").notNull(),
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
    status: text("status").notNull().default("DRAFT"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    seedRespondentUnique: unique("seed_application_seed_respondent_unique").on(table.seedId, table.respondentId),
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
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
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
      source_project_id TEXT NOT NULL, source_project_title TEXT NOT NULL,
      seed_text TEXT NOT NULL, unit_type TEXT NOT NULL, protocol TEXT NOT NULL,
      genre TEXT NOT NULL, tone TEXT NOT NULL, language TEXT NOT NULL,
      plot_constraints TEXT NOT NULL DEFAULT '', desired_role TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'SEED_AND_BRIEF',
      respondent_limit INTEGER NOT NULL DEFAULT 3,
      availability TEXT NOT NULL DEFAULT 'OPEN',
      published_at INTEGER NOT NULL, closed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE seed_applications (
      id TEXT PRIMARY KEY NOT NULL, seed_id TEXT NOT NULL,
      respondent_id TEXT NOT NULL, respondent_name TEXT NOT NULL,
      source_project_title TEXT NOT NULL, source_seed_text TEXT NOT NULL,
      draft_text TEXT NOT NULL DEFAULT '', draft_comments TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT', submitted_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (seed_id, respondent_id)
    );
    CREATE TABLE continuation_submissions (
      id TEXT PRIMARY KEY NOT NULL, application_id TEXT NOT NULL,
      seed_id TEXT NOT NULL, creator_id TEXT NOT NULL, respondent_id TEXT NOT NULL,
      respondent_name TEXT NOT NULL, source_project_title TEXT NOT NULL,
      seed_text TEXT NOT NULL, continuation_text TEXT NOT NULL,
      comments TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
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
      current_turn TEXT NOT NULL DEFAULT 'CREATOR', locked_at INTEGER,
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
      sender_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
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
      resource_id TEXT, created_at INTEGER NOT NULL
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
    collaborationWorkBlocksTable,
    collaborationStoryBibleEntriesTable,
    collaborationActivityEventsTable,
    oracleProvidersTable,
    oracleHealthEventsTable,
  };
  return { db, tables, exports: { db, ...tables } };
}
