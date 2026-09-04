import {
  db,
  tandemChannelsTable,
  tandemChannelMembersTable,
  tandemVideoMembersTable,
  tandemVideoProjectsTable,
  type TandemChannelMember,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Channel membership lifecycle — the single source of truth for who appears
// on a channel (the owner's contributor strip and every editor's CMS mirror
// card).
//
//   channelMembership(channelId, userId) — the caller's OWNER/EDITOR row
//   ensureChannelEditor(channelId, userId) — called when a Captain adds a user
//     to a project on the channel; idempotent, skips the channel owner
//   syncChannelEditors(channelId) — called after a project membership ends or
//     a project is deleted; drops EDITOR rows whose last membership on any
//     project in the channel is gone
// ---------------------------------------------------------------------------

export async function channelMembership(
  channelId: string,
  userId: string,
): Promise<TandemChannelMember | null> {
  const [row] = await db
    .select()
    .from(tandemChannelMembersTable)
    .where(
      and(
        eq(tandemChannelMembersTable.channelId, channelId),
        eq(tandemChannelMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Adds an EDITOR row for a user on a channel (no-op when already there). */
export async function ensureChannelEditor(channelId: string, userId: string): Promise<void> {
  if (!channelId || !userId) return;
  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, channelId))
    .limit(1);
  if (!channel) return;
  // The channel owner already has their OWNER row — never duplicate it.
  if (channel.ownerId === userId) return;

  const existing = await channelMembership(channelId, userId);
  if (existing) return;

  try {
    await db.insert(tandemChannelMembersTable).values({
      id: randomUUID(),
      channelId,
      userId,
      role: "EDITOR",
    });
  } catch {
    // Unique (channel, user) race — the row already exists; fine.
  }
}

/**
 * Removes EDITOR rows whose last ACTIVE membership on any project in the
 * channel has ended. Run after removing a member from a project or deleting a
 * project, so a user who is no longer on anything in the channel loses their
 * mirror card (the OWNER row is untouched).
 */
export async function syncChannelEditors(channelId: string): Promise<void> {
  if (!channelId) return;
  const editors = await db
    .select()
    .from(tandemChannelMembersTable)
    .where(
      and(
        eq(tandemChannelMembersTable.channelId, channelId),
        eq(tandemChannelMembersTable.role, "EDITOR"),
      ),
    );
  if (editors.length === 0) return;

  const projects = await db
    .select({ id: tandemVideoProjectsTable.id })
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.channelId, channelId));
  if (projects.length === 0) {
    // No projects left in the channel — every editor loses their card.
    await db
      .delete(tandemChannelMembersTable)
      .where(
        and(
          eq(tandemChannelMembersTable.channelId, channelId),
          eq(tandemChannelMembersTable.role, "EDITOR"),
        ),
      );
    return;
  }

  const activeRows = await db
    .select({ userId: tandemVideoMembersTable.userId })
    .from(tandemVideoMembersTable)
    .where(
      and(
        inArray(tandemVideoMembersTable.projectId, projects.map((p) => p.id)),
        eq(tandemVideoMembersTable.status, "ACTIVE"),
      ),
    );
  const activeUserIds = new Set(activeRows.map((r) => r.userId));
  const orphaned = editors.filter((editor) => !activeUserIds.has(editor.userId));
  if (orphaned.length === 0) return;

  await db
    .delete(tandemChannelMembersTable)
    .where(
      inArray(
        tandemChannelMembersTable.id,
        orphaned.map((e) => e.id),
      ),
    );
}
