import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// A unit of authored work inside a shared Tandem project. The seed and the
// accepted continuation become the first locked blocks; later passes create
// new blocks. Submitted/approved blocks are immutable in the manuscript.
export const collaborationWorkBlocksTable = pgTable(
  "collaboration_work_blocks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    ownerId: text("owner_id").notNull(),
    // SEED | CONTINUATION | FOLLOWUP
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    // DRAFT -> SUBMITTED -> APPROVED (approved blocks are LOCKED in the manuscript)
    status: text("status").notNull().default("DRAFT"),
    parentBlockId: text("parent_block_id"),
    turnOrder: integer("turn_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectIdUnique: unique("collaboration_work_block_project_kind").on(
      table.projectId,
      table.kind,
      table.ownerId,
    ),
  }),
);

// Shared and owner-scoped story facts for a Tandem project. OWNER entries are
// only visible to the author who created them; SHARED entries are visible to
// both participants.
export const collaborationStoryBibleEntriesTable = pgTable(
  "collaboration_story_bible_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    // character | location | item | rule | note
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    ownerId: text("owner_id").notNull(),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// Immutable contribution genealogy: one row per authored contribution that
// entered a project (the seed, the accepted continuation, and each approved
// pass). Preserves human attribution and the parent/child chain so history and
// exports can always say who wrote what and what it continues from.
export const collaborationGenealogyTable = pgTable(
  "collaboration_genealogy",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    blockId: text("block_id"),
    parentBlockId: text("parent_block_id"),
    contributorId: text("contributor_id").notNull(),
    contributorName: text("contributor_name").notNull(),
    // CREATOR | RESPONDENT — the contributor's role at the time of the pass
    role: text("role").notNull(),
    // SEED | CONTINUATION | BLOCK
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// Privacy-safe activity events for collaboration flows. Events only carry
// permitted summaries and resource references, never hidden prose.
export const collaborationActivityEventsTable = pgTable(
  "collaboration_activity_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id"),
    seedId: text("seed_id"),
    actorId: text("actor_id").notNull(),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    resourceId: text("resource_id"),
    /** Creator Den only — the leg the event belongs to (SELECTS/CUT/SOUND/FINISH/THUMBNAIL); null for vault-wide events like uploads. Author Den events leave this unset. */
    leg: text("leg"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const insertCollaborationWorkBlockSchema = createInsertSchema(collaborationWorkBlocksTable);
export const insertCollaborationStoryBibleEntrySchema = createInsertSchema(collaborationStoryBibleEntriesTable);
export const insertCollaborationActivityEventSchema = createInsertSchema(collaborationActivityEventsTable);
export const insertCollaborationGenealogySchema = createInsertSchema(collaborationGenealogyTable);

export type CollaborationWorkBlock = typeof collaborationWorkBlocksTable.$inferSelect;
export type CollaborationStoryBibleEntry = typeof collaborationStoryBibleEntriesTable.$inferSelect;
export type CollaborationActivityEvent = typeof collaborationActivityEventsTable.$inferSelect;
export type CollaborationGenealogy = typeof collaborationGenealogyTable.$inferSelect;
