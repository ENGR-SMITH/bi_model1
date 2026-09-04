// ---------------------------------------------------------------------------
// Realtime layer (blueprint §6 / §11) — Socket.IO, same pattern as the parent
// app. One socket server attached to the API HTTP server.
//
//   - Auth: Clerk JWT in the handshake (`auth.token`), verified with the same
//     SDK the REST middleware uses, so rooms map 1:1 to the Clerk identity the
//     routes already trust. Connections without a valid token are rejected.
//   - Rooms: `project:{id}` for everything that happens in a vault/studio,
//     `user:{userId}` for personal notifications. Emit helpers no-op when the
//     server is not running (unit tests mount routers without a socket server).
//   - Presence: clients announce which project + leg they are working in; the
//     roster is broadcast to the project room so "Nia is editing Leg 2" shows
//     live. Presence is in-memory only (blueprint keeps state in Postgres;
//     presence is inherently ephemeral).
//
// Client events:  presence:join { projectId, leg?, name? }
//                 presence:update { projectId, leg? }
//                 presence:leave { projectId }
// Server events:  presence.roster, presence.updated, job.progress,
//                 comment.new, comment.updated, submission.new,
//                 submission.decided, notification.new, asset.uploaded,
//                 asset.processed, timeline.saved
// ---------------------------------------------------------------------------

import { Server, type Socket } from "socket.io";
import { verifyToken } from "@clerk/express";
import type { Server as HttpServer } from "node:http";
import { logger } from "./lib/logger";

let io: Server | null = null;

export type PresenceEntry = {
  userId: string;
  name: string;
  leg: string | null;
  joinedAt: number;
};

// Channel-level presence: who is active on ANY project in a channel (or on
// the channel home itself). Entries carry the projectId so the channel home
// can light up per-project avatar stacks on its project carousel.
export type ChannelPresenceEntry = {
  userId: string;
  name: string;
  projectId: string | null;
  leg: string | null;
  joinedAt: number;
};

// projectId -> userId -> presence entry
const presenceByProject = new Map<string, Map<string, PresenceEntry>>();
// channelId -> userId -> presence entry
const presenceByChannel = new Map<string, Map<string, ChannelPresenceEntry>>();

const PROJECT_ROOM = (projectId: string) => `project:${projectId}`;
const CHANNEL_ROOM = (channelId: string) => `channel:${channelId}`;
const USER_ROOM = (userId: string) => `user:${userId}`;

function displayNameFor(socket: Socket): string {
  return String(socket.data.name ?? "Teammate");
}

function broadcastRoster(projectId: string): void {
  const room = PROJECT_ROOM(projectId);
  const roster = [...(presenceByProject.get(projectId)?.values() ?? [])];
  // Everyone in the room learns the new roster at once.
  io?.to(room).emit("presence.updated", { projectId, roster });
}

function broadcastChannelRoster(channelId: string): void {
  const room = CHANNEL_ROOM(channelId);
  const roster = [...(presenceByChannel.get(channelId)?.values() ?? [])];
  io?.to(room).emit("channel.presence", { channelId, roster });
}

/** Drops the user's presence entry for a specific project on a channel. */
function removeChannelProjectEntry(
  socket: Socket,
  channelId: string,
  projectId: string,
): void {
  const entries = presenceByChannel.get(channelId);
  const userId = socket.data.userId as string | undefined;
  if (!entries || !userId) return;
  const entry = entries.get(userId);
  if (entry && entry.projectId === projectId) entries.delete(userId);
  if (entries.size === 0) presenceByChannel.delete(channelId);
  broadcastChannelRoster(channelId);
}

function leaveProject(socket: Socket, projectId: string): void {
  const entries = presenceByProject.get(projectId);
  const userId = socket.data.userId as string | undefined;
  if (entries && userId) entries.delete(userId);
  if (entries && entries.size === 0) presenceByProject.delete(projectId);
  socket.leave(PROJECT_ROOM(projectId));
  broadcastRoster(projectId);

  // The user may also be visible on a channel through this project (presence
  // joins carry the channel id when the caller is inside a channel-scoped
  // page). Drop that contribution to the channel roster.
  const channelId = socket.data.projectChannel as Record<string, string> | undefined;
  if (channelId && channelId[projectId]) {
    removeChannelProjectEntry(socket, channelId[projectId], projectId);
  }
}

/**
 * Attaches Socket.IO to the API HTTP server with Clerk JWT authentication.
 * Idempotent — safe to call once at boot (index.ts).
 */
export function initRealtime(server: HttpServer): Server {
  if (io) return io;

  io = new Server(server, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("Authentication token missing"));
      return;
    }
    try {
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
      const userId = payload.sub;
      if (!userId) {
        next(new Error("Invalid session token"));
        return;
      }
      socket.data.userId = userId;
      socket.data.name = String(
        (socket.handshake.auth?.name as string | undefined) ?? "",
      );
      next();
    } catch {
      next(new Error("Invalid session token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    socket.join(USER_ROOM(userId));
    // Track the projects + channels this socket is present in so disconnect
    // can clean up both presence maps.
    socket.data.projects = new Set<string>();
    socket.data.channels = new Set<string>();
    // projectId -> channelId for the projects joined with channel context.
    socket.data.projectChannel = {} as Record<string, string>;

    socket.on("presence:join", (payload: { projectId?: string; channelId?: string | null; leg?: string | null; name?: string } | null) => {
      const projectId = payload?.projectId;
      if (!projectId) return;
      if (payload?.name) socket.data.name = String(payload.name);

      const entries = presenceByProject.get(projectId) ?? new Map<string, PresenceEntry>();
      entries.set(userId, {
        userId,
        name: displayNameFor(socket),
        leg: payload?.leg ?? null,
        joinedAt: Date.now(),
      });
      presenceByProject.set(projectId, entries);

      socket.join(PROJECT_ROOM(projectId));
      (socket.data.projects as Set<string>).add(projectId);

      // The joiner gets the current roster; the room gets the updated one.
      const roster = [...entries.values()];
      socket.emit("presence.roster", { projectId, roster });
      broadcastRoster(projectId);
      logger.info({ userId, projectId }, "Presence joined");

      // Channel-scoped pages also feed the channel roster (channel home shows
      // who is active on any project in the channel + per-project dots).
      const channelId = payload?.channelId || null;
      if (channelId) {
        const channelEntries =
          presenceByChannel.get(channelId) ?? new Map<string, ChannelPresenceEntry>();
        channelEntries.set(userId, {
          userId,
          name: displayNameFor(socket),
          projectId,
          leg: payload?.leg ?? null,
          joinedAt: Date.now(),
        });
        presenceByChannel.set(channelId, channelEntries);
        socket.join(CHANNEL_ROOM(channelId));
        (socket.data.channels as Set<string>).add(channelId);
        (socket.data.projectChannel as Record<string, string>)[projectId] = channelId;
        broadcastChannelRoster(channelId);
      }
    });

    // The channel home (no project open) subscribes to the channel roster and
    // is itself visible on the channel (projectId: null) so teammates see the
    // home is occupied.
    socket.on("presence:channelJoin", (payload: { channelId?: string } | null) => {
      const channelId = payload?.channelId;
      if (!channelId) return;
      socket.join(CHANNEL_ROOM(channelId));
      (socket.data.channels as Set<string>).add(channelId);
      const channelEntries =
        presenceByChannel.get(channelId) ?? new Map<string, ChannelPresenceEntry>();
      channelEntries.set(userId, {
        userId,
        name: displayNameFor(socket),
        projectId: null,
        leg: null,
        joinedAt: Date.now(),
      });
      presenceByChannel.set(channelId, channelEntries);
      const roster = [...channelEntries.values()];
      socket.emit("channel.presence", { channelId, roster });
      broadcastChannelRoster(channelId);
    });

    socket.on("presence:channelLeave", (payload: { channelId?: string } | null) => {
      const channelId = payload?.channelId;
      if (!channelId) return;
      socket.leave(CHANNEL_ROOM(channelId));
      (socket.data.channels as Set<string>).delete(channelId);
      const channelEntries = presenceByChannel.get(channelId);
      if (channelEntries) {
        // Only drop the home presence (projectId null); project-scoped entries
        // are removed when their project presence leaves.
        const entry = channelEntries.get(userId);
        if (entry && entry.projectId === null) {
          channelEntries.delete(userId);
          if (channelEntries.size === 0) presenceByChannel.delete(channelId);
        }
      }
      broadcastChannelRoster(channelId);
    });

    socket.on("presence:update", (payload: { projectId?: string; leg?: string | null } | null) => {
      const projectId = payload?.projectId;
      if (!projectId) return;
      const entry = presenceByProject.get(projectId)?.get(userId);
      if (entry) {
        entry.leg = payload?.leg ?? null;
        broadcastRoster(projectId);
      }
    });

    socket.on("presence:leave", (payload: { projectId?: string } | null) => {
      const projectId = payload?.projectId;
      if (!projectId) return;
      (socket.data.projects as Set<string>).delete(projectId);
      leaveProject(socket, projectId);
      logger.info({ userId, projectId }, "Presence left");
    });

    socket.on("disconnect", () => {
      for (const projectId of socket.data.projects as Set<string>) {
        leaveProject(socket, projectId);
      }
      // Channel-home presences (projectId null) belong to this socket only.
      for (const channelId of socket.data.channels as Set<string>) {
        const channelEntries = presenceByChannel.get(channelId);
        if (channelEntries && channelEntries.get(userId)?.projectId === null) {
          channelEntries.delete(userId);
          if (channelEntries.size === 0) presenceByChannel.delete(channelId);
          broadcastChannelRoster(channelId);
        }
      }
      logger.info({ userId }, "Socket disconnected");
    });
  });

  logger.info("Realtime server attached");
  return io;
}

// ---------------------------------------------------------------------------
// Emit helpers — used by routes and the worker. No-ops when the socket server
// is not running (e.g. isolated route tests).
// ---------------------------------------------------------------------------

export function emitToProject(projectId: string, event: string, payload: unknown): void {
  io?.to(PROJECT_ROOM(projectId)).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(USER_ROOM(userId)).emit(event, payload);
}

export function emitToChannel(channelId: string, event: string, payload: unknown): void {
  io?.to(CHANNEL_ROOM(channelId)).emit(event, payload);
}

/** Worker convenience: streams job state changes into the project room. */
export function emitJobProgress(payload: {
  projectId: string;
  jobId: string;
  type: string;
  status: string;
  error?: string | null;
  /** 0–100 percentage for multi-step jobs (e.g. EXPORT_BUNDLE). */
  progress?: number;
}): void {
  emitToProject(payload.projectId, "job.progress", payload);
}

export function getPresenceFor(projectId: string): PresenceEntry[] {
  return [...(presenceByProject.get(projectId)?.values() ?? [])];
}
