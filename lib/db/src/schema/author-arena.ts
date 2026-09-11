import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Author Den — Writers' Audition Arena.
//
// The Arena's two rails both live on `collaboration_seeds`: a 'SEED' row is the
// classic pitch-board post and a 'ROLE' row is an open writing role carrying a
// typed role + pitch. This file holds only what the seed model does not already
// provide — the writing roles and per-role watches — so the entire
// fork → submit → select → contract pipeline stays on the seed tables.
// Mirrors the plan in AUTHOR-DEN-AUDITION-ARENA-PLAN.md (§6).
// ---------------------------------------------------------------------------

/** The writing roles an author can call for. */
export const writerRoleSchema = z.enum([
  "CO_WRITER",
  "EDITOR",
  "BETA_READER",
  "GHOSTWRITER",
  "PROOFREADER",
]);
export type WriterRole = z.infer<typeof writerRoleSchema>;

export const WRITER_ROLES = writerRoleSchema.options;

/** Human labels shared by the API and the Author Den UI. */
export const WRITER_ROLE_LABELS: Record<WriterRole, string> = {
  CO_WRITER: "Co-writer",
  EDITOR: "Editor",
  BETA_READER: "Beta reader",
  GHOSTWRITER: "Ghostwriter",
  PROOFREADER: "Proofreader",
};

// Role watch alerts: notify a writer when a new OPEN role call matches a role,
// optionally scoped to one author (creatorId NULL = that role across the
// whole Arena). SQL treats NULLs as distinct in unique constraints, so a global
// watch could repeat under a naive unique — the route enforces at-most-one per
// (user, role, author-or-global) before insert.
export const collaborationArenaWatchesTable = pgTable(
  "collaboration_arena_watches",
  {
    id: text("id").primaryKey(), // wawatch_…
    userId: text("user_id").notNull(), // the watcher
    role: text("role").notNull(), // CO_WRITER | EDITOR | BETA_READER | GHOSTWRITER | PROOFREADER
    creatorId: text("creator_id"), // nullable: one author's calls, or the whole Arena
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("collaboration_arena_watch_user_idx").on(table.userId),
  }),
);

export const insertCollaborationArenaWatchSchema = createInsertSchema(
  collaborationArenaWatchesTable,
);

export type CollaborationArenaWatch = typeof collaborationArenaWatchesTable.$inferSelect;
