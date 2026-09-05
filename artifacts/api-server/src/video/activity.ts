import { randomUUID } from "node:crypto";
import { collaborationActivityEventsTable, db } from "@workspace/db";

// ---------------------------------------------------------------------------
// Creator Den activity feed (VCS design §4 — "Activity feed |
// `collaboration_activity_events` | ✅ exists"). The Author Den already records
// events into this shared table; video projects reuse it with their own
// project ids (no collision — ids are namespaced per domain). Each event is a
// small immutable line: who, what, when, and which resource it touches.
// ---------------------------------------------------------------------------

export const VIDEO_ACTIVITY_EVENT_TYPES = [
  "version_saved",
  "version_imported",
  "version_rolled_back",
  "submission_created",
  "submission_approved",
  "submission_rejected",
  "asset_uploaded",
  // Creator Den Arena (public audition system) — timeline events on the
  // project so members see posts open/close and hires land.
  "arena_post_opened",
  "arena_post_closed",
  "arena_post_filled",
  "arena_post_removed",
  "arena_application_rejected",
] as const;

export type VideoActivityEventType = (typeof VIDEO_ACTIVITY_EVENT_TYPES)[number];

export async function recordVideoActivity(event: {
  projectId: string;
  eventType: VideoActivityEventType;
  /** Human-readable action line, e.g. "Saved CUT v3 — \"tighter ending\"". */
  summary: string;
  actorId: string;
  resourceId?: string | null;
  /** The leg the event belongs to (SELECTS/CUT/SOUND/FINISH/THUMBNAIL); omit for vault-wide events like uploads. */
  leg?: string | null;
}): Promise<void> {
  await db.insert(collaborationActivityEventsTable).values({
    id: randomUUID(),
    projectId: event.projectId,
    seedId: null,
    actorId: event.actorId,
    eventType: event.eventType,
    summary: event.summary,
    resourceId: event.resourceId ?? null,
    leg: event.leg ?? null,
  });
}
