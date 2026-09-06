import fs from "node:fs";
import path from "node:path";
import { getAuth } from "@clerk/express";
import {
  db,
  tandemArenaApplicationFilesTable,
  tandemArenaApplicationsTable,
  tandemArenaBlocksTable,
  tandemArenaPostsTable,
  tandemArenaReviewsTable,
  tandemArenaWatchesTable,
  tandemChannelsTable,
  tandemVideoFollowsTable,
  tandemVideoMembersTable,
  tandemVideoProjectsTable,
  type TandemArenaApplication,
  type TandemArenaPost,
  type TandemArenaWatch,
} from "@workspace/db";
import {
  AcceptArenaApplicationParams,
  AcceptArenaApplicationResponse,
  CreateArenaApplicationParams,
  CreateArenaApplicationResponse,
  CreateArenaApplicationReviewBody,
  CreateArenaApplicationReviewParams,
  CreateArenaApplicationReviewResponse,
  CreateArenaPostBody,
  CreateArenaPostResponse,
  CreateArenaWatchBody,
  CreateArenaWatchResponse,
  DeleteArenaPostParams,
  DeleteArenaPostResponse,
  DeleteArenaWatchParams,
  GetArenaApplicationFileParams,
  GetArenaApplicationParams,
  GetArenaApplicationResponse,
  GetArenaPostParams,
  GetArenaPostResponse,
  ListArenaPostsQueryParams,
  ListArenaPostsResponse,
  ListArenaPostApplicationsParams,
  ListArenaPostApplicationsResponse,
  ListArenaReviewsQueryParams,
  ListArenaReviewsResponse,
  ListArenaWatchesResponse,
  ListMyArenaApplicationsResponse,
  RejectArenaApplicationParams,
  RejectArenaApplicationResponse,
  UpdateArenaPostBody,
  UpdateArenaPostParams,
  UpdateArenaPostResponse,
  WithdrawArenaApplicationParams,
  WithdrawArenaApplicationResponse,
} from "@workspace/api-zod";
import { and, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { recordVideoActivity } from "../video/activity";
import { resolveUserProfiles } from "../lib/user-names";
import { ensureChannelEditor } from "../channels/channel-members";
import { uploadDir } from "../video/worker";
import { notify, projectDeepLink } from "./video-platform";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Creator Den — Collaboration / Audition Arena: role posts.
//
// Captains post an OPEN role (VIDEO | AUDIO | SCRIPT | THUMBNAIL) for one of
// their channel projects; any signed-in creator can browse the board, open the
// read-only preview window while a post is OPEN, and (Phase 2) audition.
// See CREATOR-DEN-AUDITION-ARENA-PLAN.md §9.1.
//
// Access model (server-enforced, never UI-only):
//   - POST/PATCH a post: the project Captain (project owner == channel owner).
//   - List/detail: any signed-in user; the live `applicantCount` (PENDING
//     auditions) rides along, and `myApplication` reflects the caller's own
//     state. `totalApplications` is only reported to the post's Captain.
// ---------------------------------------------------------------------------

const CONTENT_ROLES = ["VIDEO", "AUDIO", "SCRIPT", "THUMBNAIL"] as const;
type ArenaRole = (typeof CONTENT_ROLES)[number];

const ROLE_LABEL: Record<ArenaRole, string> = {
  VIDEO: "Video",
  AUDIO: "Audio",
  SCRIPT: "Script",
  THUMBNAIL: "Thumbnail",
};

function arenaPostLink(postId: string): string {
  return `/creators-den/arena/posts/${postId}`;
}

type PostSummary = {
  id: string;
  channelId: string;
  projectId: string;
  role: string;
  pitch: string;
  status: string;
  postedBy: string;
  posterName: string;
  posterImageUrl: string | null;
  channelName: string;
  channelAvatarUrl: string | null;
  projectName: string;
  projectStatus: string;
  applicantCount: number;
  applicants: Array<{ id: string; name: string; imageUrl: string | null }>;
  myApplication: "none" | "pending" | "accepted" | "rejected";
  filledBy: { id: string; name: string; imageUrl: string | null } | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Hydrates posts into board rows in one pass: project + channel branding,
 * poster profiles (Clerk), the live PENDING audition count, the total
 * application count, and the viewer's own application state. Kept portable
 * across the pg schema and the in-memory SQLite mirror (no dialect SQL).
 */
async function hydratePosts(
  posts: TandemArenaPost[],
  viewerId: string,
): Promise<{ items: PostSummary[]; pendingByPost: Map<string, number>; totalByPost: Map<string, number> }> {
  if (posts.length === 0) {
    return { items: [], pendingByPost: new Map(), totalByPost: new Map() };
  }

  const postIds = posts.map((post) => post.id);
  const channelIds = [...new Set(posts.map((post) => post.channelId))];
  const projectIds = [...new Set(posts.map((post) => post.projectId))];

  const [channelRows, projectRows] = await Promise.all([
    channelIds.length > 0
      ? db
          .select()
          .from(tandemChannelsTable)
          .where(inArray(tandemChannelsTable.id, channelIds))
      : Promise.resolve([]),
    projectIds.length > 0
      ? db
          .select()
          .from(tandemVideoProjectsTable)
          .where(inArray(tandemVideoProjectsTable.id, projectIds))
      : Promise.resolve([]),
  ]);
  const channelById = new Map(channelRows.map((row) => [row.id, row]));
  const projectById = new Map(projectRows.map((row) => [row.id, row]));

  const profiles = await resolveUserProfiles([...new Set(posts.map((post) => post.postedBy))]);

  // Application state for every post in one pass: PENDING counts (the live
  // chip), totals (Captain stats row), the caller's own latest row, and the
  // ACCEPTED applicant (who filled the role — "Role filled by <name>").
  const applicationRows = await db
    .select({
      postId: tandemArenaApplicationsTable.postId,
      applicantId: tandemArenaApplicationsTable.applicantId,
      status: tandemArenaApplicationsTable.status,
      createdAt: tandemArenaApplicationsTable.createdAt,
    })
    .from(tandemArenaApplicationsTable)
    .where(inArray(tandemArenaApplicationsTable.postId, postIds));

  const pendingByPost = new Map<string, number>();
  const totalByPost = new Map<string, number>();
  // latest mine per post (newest createdAt wins when an applicant re-applied).
  const mineByPost = new Map<string, { status: string; createdAt: Date }>();
  // The one ACCEPTED application per FILLED post (its role holder).
  const hireByPost = new Map<string, string>();
  for (const row of applicationRows) {
    totalByPost.set(row.postId, (totalByPost.get(row.postId) ?? 0) + 1);
    if (row.status === "PENDING") {
      pendingByPost.set(row.postId, (pendingByPost.get(row.postId) ?? 0) + 1);
    }
    if (row.status === "ACCEPTED") {
      hireByPost.set(row.postId, row.applicantId);
    }
    if (row.applicantId === viewerId) {
      const existing = mineByPost.get(row.postId);
      if (!existing || existing.createdAt.getTime() <= row.createdAt.getTime()) {
        mineByPost.set(row.postId, { status: row.status, createdAt: row.createdAt });
      }
    }
  }

  // Distinct creators who applied to each post (any status), most recent
  // application first — capped so the board's avatar stack stays legible.
  const MAX_AVATAR_APPLICANTS = 6;
  const applicantsByPost = new Map<string, string[]>();
  for (const row of [...applicationRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const list = applicantsByPost.get(row.postId) ?? [];
    if (!list.includes(row.applicantId) && list.length < MAX_AVATAR_APPLICANTS) {
      list.push(row.applicantId);
      applicantsByPost.set(row.postId, list);
    }
  }

  // Profiles for the poster(s) plus anyone who filled a role in this batch.
  const hireProfiles = await resolveUserProfiles([...new Set(hireByPost.values())]);
  const applicantProfiles = await resolveUserProfiles([...new Set([...applicantsByPost.values()].flat())]);

  const items: PostSummary[] = posts.map((post) => {
    const channel = channelById.get(post.channelId);
    const project = projectById.get(post.projectId);
    const profile = profiles[post.postedBy];
    const mine = mineByPost.get(post.id);
    const myApplication: PostSummary["myApplication"] =
      mine && mine.status !== "WITHDRAWN"
        ? (mine.status.toLowerCase() as "pending" | "accepted" | "rejected")
        : "none";
    const hiredApplicantId = hireByPost.get(post.id);
    const hiredProfile = hiredApplicantId ? hireProfiles[hiredApplicantId] : undefined;

    return {
      id: post.id,
      channelId: post.channelId,
      projectId: post.projectId,
      role: post.role,
      pitch: post.pitch,
      status: post.status,
      postedBy: post.postedBy,
      posterName: profile?.name ?? "Tandem creator",
      posterImageUrl: profile?.imageUrl ?? null,
      channelName: channel?.name ?? "Unknown channel",
      channelAvatarUrl: channel?.youtubeAvatarUrl ?? null,
      projectName: project?.name ?? "Unknown project",
      projectStatus: project?.status ?? "",
      applicantCount: pendingByPost.get(post.id) ?? 0,
      applicants: (applicantsByPost.get(post.id) ?? []).map((id) => {
        const profile = applicantProfiles[id];
        return { id, name: profile?.name ?? "Tandem creator", imageUrl: profile?.imageUrl ?? null };
      }),
      myApplication,
      filledBy:
        hiredApplicantId && hiredProfile
          ? { id: hiredApplicantId, name: hiredProfile.name ?? "Tandem creator", imageUrl: hiredProfile.imageUrl }
          : null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  });

  return { items, pendingByPost, totalByPost };
}

/** The Clerk user ids this viewer follows (captains/creators they follow). */
async function followedCreatorIds(viewerId: string): Promise<Set<string>> {
  const rows = await db
    .select({ followingId: tandemVideoFollowsTable.followingId })
    .from(tandemVideoFollowsTable)
    .where(eq(tandemVideoFollowsTable.followerId, viewerId));
  return new Set(rows.map((row) => row.followingId));
}

/**
 * Notify role watchers that a matching OPEN post landed (notify-on-publish).
 * Every matching watch fires once per recipient: a watcher who holds both a
 * global watch and a channel-scoped watch on the same role gets the more
 * specific channel notification, never two. The poster never notifies
 * themselves; anyone who already applied to the post already knows.
 */
async function fanOutWatchNotifications(post: TandemArenaPost, projectName: string): Promise<void> {
  const watches = await db
    .select()
    .from(tandemArenaWatchesTable)
    .where(
      and(
        eq(tandemArenaWatchesTable.role, post.role),
        or(
          eq(tandemArenaWatchesTable.channelId, post.channelId),
          isNull(tandemArenaWatchesTable.channelId),
        ),
      ),
    );

  // One notification per recipient — the most specific matching watch wins.
  const byRecipient = new Map<string, TandemArenaWatch>();
  for (const watch of watches) {
    if (watch.userId === post.postedBy) continue;
    const existing = byRecipient.get(watch.userId);
    if (!existing || (existing.channelId === null && watch.channelId !== null)) {
      byRecipient.set(watch.userId, watch);
    }
  }

  const roleLabel = ROLE_LABEL[post.role as ArenaRole].toLowerCase();
  for (const recipientId of byRecipient.keys()) {
    await notify(
      recipientId,
      "video_arena_watch",
      `New ${roleLabel} audition`,
      `A new ${roleLabel} audition opened on “${projectName}” — apply before it's filled.`,
      arenaPostLink(post.id),
      post.id,
    );
  }
}

// ---------------------------------------------------------------------------
// Applications — the audition itself: a free-text message plus up to 3
// documents (multer/CV precedent in routes/account.ts).
// ---------------------------------------------------------------------------

const APPLICATIONS_PER_WEEK = 10; // §8.8 — rolling 7-day cap; no refunds on reject/withdraw
const MAX_APPLICATION_FILES = 3;
const APPLICATION_FILE_SIZE_LIMIT = 15 * 1024 * 1024; // 15 MB per document
const APPLICATION_MESSAGE_MIN = 20;
const APPLICATION_MESSAGE_MAX = 2000;

// Documents a Captain can actually open — PDFs, office docs, text, images.
const ALLOWED_DOCUMENT_MIME = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Documents land in <uploadDir>/arena with a random name (never the client's
// path); the extension survives for server-side sniffing by browsers.
const applicationUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(uploadDir(), "arena");
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: APPLICATION_FILE_SIZE_LIMIT, files: MAX_APPLICATION_FILES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOCUMENT_MIME.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error(`Unsupported document type: ${file.mimetype}`), { statusCode: 400 }));
  },
});

/** Runs a multer middleware and rejects on error (null callback = success). */
function runMulter(
  mw: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request,
  res: Response,
): Promise<void> {
  return new Promise((resolve, reject) => {
    mw(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
  });
}

function uploadedFiles(req: Request): Express.Multer.File[] {
  const files = (req as any).files;
  return Array.isArray(files) ? (files as Express.Multer.File[]) : [];
}

/** Best-effort cleanup of files multer already wrote when the request fails. */
function removeUploadedFiles(files: Express.Multer.File[]): void {
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(uploadDir(), "arena", file.filename));
    } catch {
      // Already gone or never written — nothing to clean up.
    }
  }
}

/**
 * Hydrates application rows into the wire shape: applicant profile (Clerk),
 * uploaded document metadata, and decision metadata. Portable across pg + the
 * in-memory SQLite mirror.
 */
async function hydrateApplications(rows: TandemArenaApplication[]): Promise<unknown[]> {
  if (rows.length === 0) return [];

  const applicationIds = rows.map((row) => row.id);
  const fileRows = await db
    .select()
    .from(tandemArenaApplicationFilesTable)
    .where(inArray(tandemArenaApplicationFilesTable.applicationId, applicationIds));
  const filesByApplication = new Map<string, typeof fileRows>();
  for (const file of fileRows) {
    const bucket = filesByApplication.get(file.applicationId) ?? [];
    bucket.push(file);
    filesByApplication.set(file.applicationId, bucket);
  }
  for (const bucket of filesByApplication.values()) {
    bucket.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const profiles = await resolveUserProfiles([...new Set(rows.map((row) => row.applicantId))]);

  return rows.map((row) => ({
    ...row,
    applicantName: profiles[row.applicantId]?.name ?? null,
    applicantImageUrl: profiles[row.applicantId]?.imageUrl ?? null,
    files: (filesByApplication.get(row.id) ?? []).map((file) => ({
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
    })),
  }));
}

// GET /video/arena/posts — OPEN posts across the platform (board). Optional
// role/channel/project filters, sort=newest|most_applied, followed=1 to order
// posts from captains the caller follows first, and mine=1 for the Captain's
// own management list (every status, newest first).
router.get("/video/arena/posts", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const query = ListArenaPostsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid list parameters" });
    return;
  }

  const conditions = [];
  if (query.data.mine) {
    conditions.push(eq(tandemArenaPostsTable.postedBy, userId));
  } else {
    conditions.push(eq(tandemArenaPostsTable.status, "OPEN"));
  }
  if (query.data.role) conditions.push(eq(tandemArenaPostsTable.role, query.data.role));
  if (query.data.channelId) {
    conditions.push(eq(tandemArenaPostsTable.channelId, query.data.channelId));
  }
  if (query.data.projectId) {
    conditions.push(eq(tandemArenaPostsTable.projectId, query.data.projectId));
  }

  const posts = await db
    .select()
    .from(tandemArenaPostsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tandemArenaPostsTable.createdAt));

  const { items, pendingByPost } = await hydratePosts(posts, userId);
  let ordered = items;

  // Sort: newest (default) or most_applied. Followed-first is a primary layer:
  // posts from followed captains lead, then the chosen sort applies within
  // each group (and the whole list when no follow layer is requested).
  const followed = query.data.followed
    ? await followedCreatorIds(userId)
    : new Set<string>();
  const byNewest = (a: PostSummary, b: PostSummary) =>
    b.createdAt.getTime() - a.createdAt.getTime();
  const byMostApplied = (a: PostSummary, b: PostSummary) =>
    (pendingByPost.get(b.id) ?? 0) - (pendingByPost.get(a.id) ?? 0) ||
    b.createdAt.getTime() - a.createdAt.getTime();

  if (query.data.followed && !query.data.mine) {
    const fromFollowed: PostSummary[] = [];
    const rest: PostSummary[] = [];
    for (const item of items) {
      (followed.has(item.postedBy) ? fromFollowed : rest).push(item);
    }
    const sorter = query.data.sort === "most_applied" ? byMostApplied : byNewest;
    fromFollowed.sort(sorter);
    rest.sort(sorter);
    ordered = [...fromFollowed, ...rest];
  } else if (query.data.sort === "most_applied") {
    ordered = [...items].sort(byMostApplied);
  }

  res.json(ListArenaPostsResponse.parse(ordered));
});

// POST /video/arena/posts — publish an open role on one of the Captain's
// channel projects. One OPEN post per (project, role) at a time.
router.post("/video/arena/posts", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = CreateArenaPostBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid post — project, role, and a 10–2000 character pitch are required" });
    return;
  }
  if (!CONTENT_ROLES.includes(body.data.role as ArenaRole)) {
    res.status(400).json({ error: "Unknown role" });
    return;
  }

  const [project] = await db
    .select()
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.id, body.data.projectId))
    .limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  if (!project.channelId) {
    res.status(400).json({ error: "Only projects inside a channel can post an open role" });
    return;
  }
  if (project.ownerId !== userId) {
    res.status(403).json({ error: "Only the project Captain can post an open role" });
    return;
  }

  const [channel] = await db
    .select()
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, project.channelId))
    .limit(1);
  if (!channel || channel.ownerId !== userId) {
    res.status(403).json({ error: "Only the channel owner can post an open role" });
    return;
  }

  const [duplicate] = await db
    .select({ id: tandemArenaPostsTable.id })
    .from(tandemArenaPostsTable)
    .where(
      and(
        eq(tandemArenaPostsTable.projectId, project.id),
        eq(tandemArenaPostsTable.role, body.data.role),
        eq(tandemArenaPostsTable.status, "OPEN"),
      ),
    )
    .limit(1);
  if (duplicate) {
    res.status(409).json({ error: `This project already has an open ${ROLE_LABEL[body.data.role as ArenaRole]} audition` });
    return;
  }

  const [post] = await db
    .insert(tandemArenaPostsTable)
    .values({
      id: randomUUID(),
      channelId: channel.id,
      projectId: project.id,
      role: body.data.role,
      pitch: body.data.pitch.trim(),
      status: "OPEN",
      postedBy: userId,
    })
    .returning();

  await recordVideoActivity({
    projectId: project.id,
    eventType: "arena_post_opened",
    summary: `Opened a ${ROLE_LABEL[body.data.role as ArenaRole].toLowerCase()} audition on this project`,
    actorId: userId,
    resourceId: post.id,
  });

  // Role watch alerts: everyone watching this role (whole Arena or this
  // channel) hears about the new audition.
  await fanOutWatchNotifications(post, project.name);

  const { items, totalByPost } = await hydratePosts([post], userId);
  res
    .status(201)
    .json(CreateArenaPostResponse.parse({ ...items[0], totalApplications: totalByPost.get(post.id) ?? 0 }));
});

// GET /video/arena/posts/:postId — full post. Any signed-in user may read a
// post (closed/filled posts stay readable for deep links); the Captain sees
// the total application history for the stats row.
router.get("/video/arena/posts/:postId", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = GetArenaPostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const [post] = await db
    .select()
    .from(tandemArenaPostsTable)
    .where(eq(tandemArenaPostsTable.id, params.data.postId))
    .limit(1);
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const isCaptain = post.postedBy === userId;
  const { items, totalByPost } = await hydratePosts([post], userId);
  res.json(
    GetArenaPostResponse.parse({
      ...items[0],
      // Only the Captain sees how many applications the post ever received.
      totalApplications: isCaptain ? (totalByPost.get(post.id) ?? 0) : 0,
    }),
  );
});

// PATCH /video/arena/posts/:postId — Captain only: close/reopen the post
// (status OPEN <-> CLOSED) and/or edit the pitch while OPEN. Closing notifies
// every PENDING applicant; reopening re-opens the read-only preview window.
router.patch("/video/arena/posts/:postId", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = UpdateArenaPostParams.safeParse(req.params);
  const body = UpdateArenaPostBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: "Invalid update — status (OPEN|CLOSED) or a 10–2000 character pitch" });
    return;
  }
  if (body.data.status === undefined && body.data.pitch === undefined) {
    res.status(400).json({ error: "Nothing to update — send status and/or pitch" });
    return;
  }

  const [post] = await db
    .select()
    .from(tandemArenaPostsTable)
    .where(eq(tandemArenaPostsTable.id, params.data.postId))
    .limit(1);
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.postedBy !== userId) {
    res.status(403).json({ error: "Only the Captain who posted this audition can update it" });
    return;
  }

  const targetStatus = body.data.status ?? post.status;
  if (body.data.status && post.status === "FILLED") {
    res.status(409).json({ error: "This audition was already filled and can no longer be changed" });
    return;
  }
  if (body.data.pitch !== undefined && post.status !== "OPEN") {
    res.status(409).json({ error: "The pitch can only change while the audition is open" });
    return;
  }

  const closed = targetStatus === "CLOSED" && post.status === "OPEN";
  const reopened = targetStatus === "OPEN" && post.status === "CLOSED";
  if (body.data.status && targetStatus !== post.status && !closed && !reopened) {
    // Covers OPEN->OPEN and CLOSED->CLOSED no-ops, which are harmless but
    // pointless; the only meaningful transitions are the two above.
    res.status(400).json({ error: "Invalid status transition" });
    return;
  }

  const [updated] = await db
    .update(tandemArenaPostsTable)
    .set({
      ...(body.data.pitch !== undefined ? { pitch: body.data.pitch.trim() } : {}),
      ...(body.data.status !== undefined ? { status: targetStatus } : {}),
      updatedAt: new Date(),
    })
    .where(eq(tandemArenaPostsTable.id, post.id))
    .returning();

  if (closed) {
    // The read-only preview window closes with the post; PENDING applicants
    // learn their audition survived but the door is shut for now.
    const pending = await db
      .select({ applicantId: tandemArenaApplicationsTable.applicantId })
      .from(tandemArenaApplicationsTable)
      .where(
        and(
          eq(tandemArenaApplicationsTable.postId, post.id),
          eq(tandemArenaApplicationsTable.status, "PENDING"),
        ),
      );
    for (const row of pending) {
      await notify(
        row.applicantId,
        "video_arena_closed",
        "Audition closed",
        `The ${ROLE_LABEL[post.role as ArenaRole].toLowerCase()} audition you applied for was closed by the Captain.`,
        arenaPostLink(post.id),
        post.id,
      );
    }
    await recordVideoActivity({
      projectId: post.projectId,
      eventType: "arena_post_closed",
      summary: "Closed the open audition for this project",
      actorId: userId,
      resourceId: post.id,
    });
  } else if (reopened) {
    await recordVideoActivity({
      projectId: post.projectId,
      eventType: "arena_post_opened",
      summary: "Reopened the audition for this project",
      actorId: userId,
      resourceId: post.id,
    });
  }

  const { items, totalByPost } = await hydratePosts([updated], userId);
  res.json(
    UpdateArenaPostResponse.parse({
      ...items[0],
      totalApplications: totalByPost.get(updated.id) ?? 0,
    }),
  );
});

// DELETE /video/arena/posts/:postId — Captain only: remove a live post (and
// its auditions) from the Arena entirely. The read-only audition preview
// window closes with it, and the freed role can be posted again.
router.delete("/video/arena/posts/:postId", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = DeleteArenaPostParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const [post] = await db
    .select()
    .from(tandemArenaPostsTable)
    .where(eq(tandemArenaPostsTable.id, params.data.postId))
    .limit(1);
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if (post.postedBy !== userId) {
    res.status(403).json({ error: "Only the Captain who posted this audition can remove it" });
    return;
  }

  // Best-effort cleanup of uploaded audition documents once the rows are gone.
  const storageKeys: string[] = [];
  await db.transaction(async (tx) => {
    const applicationRows = await tx
      .select({ id: tandemArenaApplicationsTable.id })
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.postId, post.id));
    if (applicationRows.length > 0) {
      const applicationIds = applicationRows.map((row) => row.id);
      const fileRows = await tx
        .select({ storageKey: tandemArenaApplicationFilesTable.storageKey })
        .from(tandemArenaApplicationFilesTable)
        .where(inArray(tandemArenaApplicationFilesTable.applicationId, applicationIds));
      storageKeys.push(...fileRows.map((row) => row.storageKey));
      await tx
        .delete(tandemArenaApplicationFilesTable)
        .where(inArray(tandemArenaApplicationFilesTable.applicationId, applicationIds));
      await tx
        .delete(tandemArenaApplicationsTable)
        .where(eq(tandemArenaApplicationsTable.postId, post.id));
    }
    await tx.delete(tandemArenaPostsTable).where(eq(tandemArenaPostsTable.id, post.id));
  });
  for (const key of storageKeys) {
    try {
      fs.unlinkSync(path.join(uploadDir(), "arena", key));
    } catch {
      // Already gone or never written — nothing to clean up.
    }
  }

  await recordVideoActivity({
    projectId: post.projectId,
    eventType: "arena_post_removed",
    summary: `Removed the open ${ROLE_LABEL[post.role as ArenaRole].toLowerCase()} audition from the Arena`,
    actorId: userId,
    resourceId: post.id,
  });

  res.json(DeleteArenaPostResponse.parse({ removed: true }));
});

// POST /video/arena/posts/:postId/applications — audition for an open role
// (multipart: a message + up to 3 documents). The full authz wall runs
// server-side: post must be OPEN, the caller must not be the Captain or an
// ACTIVE member, no existing PENDING audition, under the per-week cap, and
// not blocked by this Captain.
router.post(
  "/video/arena/posts/:postId/applications",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = CreateArenaApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid post id" });
      return;
    }

    const [post] = await db
      .select()
      .from(tandemArenaPostsTable)
      .where(eq(tandemArenaPostsTable.id, params.data.postId))
      .limit(1);
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    if (post.status !== "OPEN") {
      res.status(409).json({ error: "This audition is no longer open" });
      return;
    }
    if (post.postedBy === userId) {
      res.status(409).json({ error: "You cannot audition for your own post" });
      return;
    }

    const [project] = await db
      .select()
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.id, post.projectId))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const [member] = await db
      .select()
      .from(tandemVideoMembersTable)
      .where(
        and(
          eq(tandemVideoMembersTable.projectId, project.id),
          eq(tandemVideoMembersTable.userId, userId),
          eq(tandemVideoMembersTable.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (member) {
      res.status(409).json({ error: "You are already a member of this project's team" });
      return;
    }

    // Per-Captain block: this Captain has blacklisted the caller.
    const [block] = await db
      .select({ id: tandemArenaBlocksTable.id })
      .from(tandemArenaBlocksTable)
      .where(
        and(
          eq(tandemArenaBlocksTable.captainId, post.postedBy),
          eq(tandemArenaBlocksTable.applicantId, userId),
        ),
      )
      .limit(1);
    if (block) {
      res.status(403).json({ error: "The Captain has blocked you from applying to their auditions" });
      return;
    }

    // One PENDING audition per (post, applicant).
    const [pending] = await db
      .select({ id: tandemArenaApplicationsTable.id })
      .from(tandemArenaApplicationsTable)
      .where(
        and(
          eq(tandemArenaApplicationsTable.postId, post.id),
          eq(tandemArenaApplicationsTable.applicantId, userId),
          eq(tandemArenaApplicationsTable.status, "PENDING"),
        ),
      )
      .limit(1);
    if (pending) {
      res.status(409).json({ error: "You already have a pending audition for this role" });
      return;
    }

    // Per-week apply cap (rolling 7 days, all statuses — no refunds).
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = await db
      .select({ id: tandemArenaApplicationsTable.id })
      .from(tandemArenaApplicationsTable)
      .where(
        and(
          eq(tandemArenaApplicationsTable.applicantId, userId),
          gte(tandemArenaApplicationsTable.createdAt, weekAgo),
        ),
      );
    if (recent.length >= APPLICATIONS_PER_WEEK) {
      res.status(429).json({ error: `You have reached the limit of ${APPLICATIONS_PER_WEEK} applications per week` });
      return;
    }

    // Parse the multipart body (message field + files) and validate.
    let uploadError: unknown = null;
    try {
      await runMulter(applicationUpload.array("files", MAX_APPLICATION_FILES), req, res);
    } catch (error) {
      uploadError = error;
    }
    if (uploadError) {
      removeUploadedFiles(uploadedFiles(req));
      if (uploadError instanceof multer.MulterError) {
        if (uploadError.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ error: "Each document must be 15 MB or smaller" });
          return;
        }
        if (
          uploadError.code === "LIMIT_UNEXPECTED_FILE" ||
          uploadError.code === "LIMIT_FILE_COUNT"
        ) {
          res.status(400).json({ error: `You may attach at most ${MAX_APPLICATION_FILES} documents` });
          return;
        }
        res.status(400).json({ error: "Invalid upload" });
        return;
      }
      const message = uploadError instanceof Error ? uploadError.message : "Invalid upload";
      res.status(400).json({ error: message });
      return;
    }

    const files = uploadedFiles(req);
    const rawMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (rawMessage.length < APPLICATION_MESSAGE_MIN || rawMessage.length > APPLICATION_MESSAGE_MAX) {
      removeUploadedFiles(files);
      res.status(400).json({
        error: `Your application message must be ${APPLICATION_MESSAGE_MIN}–${APPLICATION_MESSAGE_MAX} characters`,
      });
      return;
    }

    const applicationId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(tandemArenaApplicationsTable).values({
        id: applicationId,
        postId: post.id,
        projectId: project.id,
        role: post.role,
        applicantId: userId,
        message: rawMessage,
        status: "PENDING",
      });
      if (files.length > 0) {
        await tx.insert(tandemArenaApplicationFilesTable).values(
          files.map((file) => ({
            id: randomUUID(),
            applicationId,
            fileName: file.originalname.slice(0, 255),
            mimeType: file.mimetype || "application/octet-stream",
            sizeBytes: file.size,
            storageKey: file.filename,
          })),
        );
      }
    });

    const [created] = await db
      .select()
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.id, applicationId))
      .limit(1);
    const [item] = (await hydrateApplications([created])) as Array<Record<string, unknown>>;

    const profiles = await resolveUserProfiles([userId]);
    const applicantName = profiles[userId]?.name ?? null;
    await notify(
      post.postedBy,
      "video_arena_applied",
      "New audition",
      `${applicantName ?? "A creator"} applied for the ${ROLE_LABEL[post.role as ArenaRole].toLowerCase()} role on “${project.name}”.`,
      arenaPostLink(post.id),
      applicationId,
    );

    res.status(201).json(CreateArenaApplicationResponse.parse(item));
  },
);

// GET /video/arena/posts/:postId/applications — every audition on a post,
// newest first, with applicant profiles + documents (Captain only).
router.get(
  "/video/arena/posts/:postId/applications",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListArenaPostApplicationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid post id" });
      return;
    }

    const [post] = await db
      .select()
      .from(tandemArenaPostsTable)
      .where(eq(tandemArenaPostsTable.id, params.data.postId))
      .limit(1);
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    if (post.postedBy !== userId) {
      res.status(403).json({ error: "Only the Captain can view the applications on this post" });
      return;
    }

    const rows = await db
      .select()
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.postId, post.id))
      .orderBy(desc(tandemArenaApplicationsTable.createdAt));

    res.json(ListArenaPostApplicationsResponse.parse(await hydrateApplications(rows)));
  },
);

// GET /video/arena/applications/mine — the caller's own auditions (My
// Auditions). Registered before /:applicationId so 'mine' never reads as an id.
router.get("/video/arena/applications/mine", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const rows = await db
    .select()
    .from(tandemArenaApplicationsTable)
    .where(eq(tandemArenaApplicationsTable.applicantId, userId))
    .orderBy(desc(tandemArenaApplicationsTable.createdAt));

  res.json(ListMyArenaApplicationsResponse.parse(await hydrateApplications(rows)));
});

/** True when the caller may see this application (the applicant or the post's Captain). */
async function canViewApplication(application: TandemArenaApplication, userId: string): Promise<boolean> {
  if (application.applicantId === userId) return true;
  const [post] = await db
    .select({ postedBy: tandemArenaPostsTable.postedBy })
    .from(tandemArenaPostsTable)
    .where(eq(tandemArenaPostsTable.id, application.postId))
    .limit(1);
  return post?.postedBy === userId;
}

// GET /video/arena/applications/:applicationId — one audition; the applicant
// themself or the Captain. Anyone else gets 404 so the row's existence is
// never leaked.
router.get(
  "/video/arena/applications/:applicationId",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetArenaApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid application id" });
      return;
    }

    const [application] = await db
      .select()
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.id, params.data.applicationId))
      .limit(1);
    if (!application || !(await canViewApplication(application, userId))) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const [item] = (await hydrateApplications([application])) as Array<Record<string, unknown>>;
    res.json(GetArenaApplicationResponse.parse(item));
  },
);

// GET /video/arena/applications/:applicationId/files/:fileId — stream one
// stored document (applicant or Captain only).
router.get(
  "/video/arena/applications/:applicationId/files/:fileId",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetArenaApplicationFileParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid application or file id" });
      return;
    }

    const [application] = await db
      .select()
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.id, params.data.applicationId))
      .limit(1);
    if (!application || !(await canViewApplication(application, userId))) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const [file] = await db
      .select()
      .from(tandemArenaApplicationFilesTable)
      .where(
        and(
          eq(tandemArenaApplicationFilesTable.id, params.data.fileId),
          eq(tandemArenaApplicationFilesTable.applicationId, application.id),
        ),
      )
      .limit(1);
    if (!file) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const filePath = path.join(uploadDir(), "arena", file.storageKey);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Document file missing on disk" });
      return;
    }
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(file.fileName)}"`,
    );
    fs.createReadStream(filePath).pipe(res);
  },
);

// POST /video/arena/applications/:applicationId/accept — hire the applicant.
// Atomic: application ACCEPTED → post FILLED → remaining PENDING auditions
// auto-declined → member row (role) → channel editor row → notifications.
router.post(
  "/video/arena/applications/:applicationId/accept",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = AcceptArenaApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid application id" });
      return;
    }

    const [application] = await db
      .select()
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.id, params.data.applicationId))
      .limit(1);
    if (!application) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const [post] = await db
      .select()
      .from(tandemArenaPostsTable)
      .where(eq(tandemArenaPostsTable.id, application.postId))
      .limit(1);
    if (!post || post.postedBy !== userId) {
      res.status(403).json({ error: "Only the Captain of this audition can accept it" });
      return;
    }
    if (application.status !== "PENDING") {
      res.status(409).json({ error: "This audition is no longer pending" });
      return;
    }
    if (post.status === "FILLED") {
      res.status(409).json({ error: "This audition was already filled" });
      return;
    }

    // Guard against a member row appearing between apply and accept.
    const [existingMember] = await db
      .select()
      .from(tandemVideoMembersTable)
      .where(
        and(
          eq(tandemVideoMembersTable.projectId, post.projectId),
          eq(tandemVideoMembersTable.userId, application.applicantId),
        ),
      )
      .limit(1);
    if (existingMember?.status === "ACTIVE") {
      res.status(409).json({ error: "That user is already a member of this project" });
      return;
    }

    const now = new Date();
    const declinedIds: string[] = [];
    let accepted: TandemArenaApplication | undefined;
    await db.transaction(async (tx) => {
      [accepted] = await tx
        .update(tandemArenaApplicationsTable)
        .set({ status: "ACCEPTED", decidedBy: userId, decidedAt: now, updatedAt: now })
        .where(eq(tandemArenaApplicationsTable.id, application.id))
        .returning();

      await tx
        .update(tandemArenaPostsTable)
        .set({ status: "FILLED", updatedAt: now })
        .where(eq(tandemArenaPostsTable.id, post.id));

      const remaining = await tx
        .select({ id: tandemArenaApplicationsTable.id })
        .from(tandemArenaApplicationsTable)
        .where(
          and(
            eq(tandemArenaApplicationsTable.postId, post.id),
            eq(tandemArenaApplicationsTable.status, "PENDING"),
            ne(tandemArenaApplicationsTable.id, application.id),
          ),
        );
      declinedIds.push(...remaining.map((row) => row.id));
      if (remaining.length > 0) {
        await tx
          .update(tandemArenaApplicationsTable)
          .set({ status: "REJECTED", decidedBy: userId, decidedAt: now, updatedAt: now })
          .where(
            and(
              eq(tandemArenaApplicationsTable.postId, post.id),
              eq(tandemArenaApplicationsTable.status, "PENDING"),
              ne(tandemArenaApplicationsTable.id, application.id),
            ),
          );
      }

      // Insert or reactivate the member row holding the hired role.
      const roles = new Set([...(existingMember?.roles ?? []), post.role]);
      if (existingMember) {
        await tx
          .update(tandemVideoMembersTable)
          .set({ roles: [...roles], status: "ACTIVE" })
          .where(eq(tandemVideoMembersTable.id, existingMember.id));
      } else {
        await tx.insert(tandemVideoMembersTable).values({
          id: randomUUID(),
          projectId: post.projectId,
          userId: application.applicantId,
          roles: [post.role],
          status: "ACTIVE",
        });
      }
    });

    if (!accepted) {
      res.status(409).json({ error: "This audition is no longer pending" });
      return;
    }

    // The hire becomes an EDITOR on the channel (mirror card in the CMS).
    await ensureChannelEditor(post.channelId, application.applicantId);

    const profiles = await resolveUserProfiles([application.applicantId]);
    const applicantName = profiles[application.applicantId]?.name ?? null;
    await recordVideoActivity({
      projectId: post.projectId,
      eventType: "arena_post_filled",
      summary: `${applicantName ?? "A creator"} joined as ${ROLE_LABEL[post.role as ArenaRole].toLowerCase()} via audition`,
      actorId: userId,
      resourceId: accepted.id,
    });

    // The hire lands on the now-member channel-scoped project page.
    await notify(
      application.applicantId,
      "video_arena_accepted",
      "Audition accepted",
      `You're in! The Captain accepted your audition — you're now the ${ROLE_LABEL[post.role as ArenaRole].toLowerCase()} on this project.`,
      projectDeepLink(post.channelId, post.projectId),
      accepted.id,
    );
    for (const declinedId of declinedIds) {
      await notify(
        declinedId,
        "video_arena_rejected",
        "Audition declined",
        "This audition was filled by another creator.",
        arenaPostLink(post.id),
        declinedId,
      );
    }

    const [acceptedItem] = (await hydrateApplications([accepted])) as Array<Record<string, unknown>>;
    res.json(AcceptArenaApplicationResponse.parse(acceptedItem));
  },
);

// POST /video/arena/applications/:applicationId/reject — decline one audition
// (Captain only, PENDING only).
router.post(
  "/video/arena/applications/:applicationId/reject",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = RejectArenaApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid application id" });
      return;
    }

    const [application] = await db
      .select()
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.id, params.data.applicationId))
      .limit(1);
    if (!application) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const [post] = await db
      .select()
      .from(tandemArenaPostsTable)
      .where(eq(tandemArenaPostsTable.id, application.postId))
      .limit(1);
    if (!post || post.postedBy !== userId) {
      res.status(403).json({ error: "Only the Captain of this audition can reject it" });
      return;
    }
    if (application.status !== "PENDING") {
      res.status(409).json({ error: "This audition is no longer pending" });
      return;
    }

    const now = new Date();
    const [rejected] = await db
      .update(tandemArenaApplicationsTable)
      .set({ status: "REJECTED", decidedBy: userId, decidedAt: now, updatedAt: now })
      .where(eq(tandemArenaApplicationsTable.id, application.id))
      .returning();

    await notify(
      application.applicantId,
      "video_arena_rejected",
      "Audition declined",
      `The Captain declined your audition for the ${ROLE_LABEL[post.role as ArenaRole].toLowerCase()} role.`,
      arenaPostLink(post.id),
      rejected.id,
    );

    const [item] = (await hydrateApplications([rejected])) as Array<Record<string, unknown>>;
    res.json(RejectArenaApplicationResponse.parse(item));
  },
);

// POST /video/arena/applications/:applicationId/withdraw — pull a PENDING
// audition (applicant only). The live applicant count drops; the Captain is
// notified. Withdrawals do not refund a per-week cap slot.
router.post(
  "/video/arena/applications/:applicationId/withdraw",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = WithdrawArenaApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid application id" });
      return;
    }

    const [application] = await db
      .select()
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.id, params.data.applicationId))
      .limit(1);
    if (!application || application.applicantId !== userId) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (application.status !== "PENDING") {
      res.status(409).json({ error: "Only a pending audition can be withdrawn" });
      return;
    }

    const [withdrawn] = await db
      .update(tandemArenaApplicationsTable)
      .set({ status: "WITHDRAWN", updatedAt: new Date() })
      .where(eq(tandemArenaApplicationsTable.id, application.id))
      .returning();

    // The Captain learns the audition is no longer competing.
    const [post] = await db
      .select({ postedBy: tandemArenaPostsTable.postedBy })
      .from(tandemArenaPostsTable)
      .where(eq(tandemArenaPostsTable.id, application.postId))
      .limit(1);
    if (post) {
      const profiles = await resolveUserProfiles([userId]);
      await notify(
        post.postedBy,
        "video_arena_withdrawn",
        "Audition withdrawn",
        `${profiles[userId]?.name ?? "A creator"} withdrew their audition for this role.`,
        arenaPostLink(application.postId),
        withdrawn.id,
      );
    }

    const [item] = (await hydrateApplications([withdrawn])) as Array<Record<string, unknown>>;
    res.json(WithdrawArenaApplicationResponse.parse(item));
  },
);

// POST /video/arena/applications/:applicationId/review — a mutual work review
// after a hire. Only the two participants of an ACCEPTED application: the
// Captain may review the hired applicant and the hired applicant may review
// the Captain, once each per hire (409 on duplicates). Reviews are public
// profile data rendered on the reviewee's Creator Den profile.
router.post(
  "/video/arena/applications/:applicationId/review",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = CreateArenaApplicationReviewParams.safeParse(req.params);
    const body = CreateArenaApplicationReviewBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "A rating (1–5) and a short note (max 500 characters) are required" });
      return;
    }

    const [application] = await db
      .select()
      .from(tandemArenaApplicationsTable)
      .where(eq(tandemArenaApplicationsTable.id, params.data.applicationId))
      .limit(1);
    if (!application) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (application.status !== "ACCEPTED") {
      res.status(409).json({ error: "Only a completed hire can be reviewed" });
      return;
    }

    const [post] = await db
      .select()
      .from(tandemArenaPostsTable)
      .where(eq(tandemArenaPostsTable.id, application.postId))
      .limit(1);
    if (!post) {
      // Without the post there is no Captain to pair the review with.
      res.status(409).json({ error: "This hire can no longer be reviewed" });
      return;
    }
    // The participants are the Captain (post owner) and the hired applicant.
    const captainId = post.postedBy;
    const hiredId = application.applicantId;
    if (userId !== captainId && userId !== hiredId) {
      res.status(403).json({ error: "Only the Captain and the hired creator can review this hire" });
      return;
    }

    // One review per participant per hire (unique application + reviewer).
    const [existing] = await db
      .select({ id: tandemArenaReviewsTable.id })
      .from(tandemArenaReviewsTable)
      .where(
        and(
          eq(tandemArenaReviewsTable.applicationId, application.id),
          eq(tandemArenaReviewsTable.reviewerId, userId),
        ),
      )
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "You already reviewed this hire" });
      return;
    }

    const reviewerId = userId;
    const revieweeId = reviewerId === captainId ? hiredId : captainId;
    const [review] = await db
      .insert(tandemArenaReviewsTable)
      .values({
        id: randomUUID(),
        applicationId: application.id,
        projectId: application.projectId,
        role: application.role,
        reviewerId,
        revieweeId,
        rating: body.data.rating,
        note: body.data.note.trim(),
      })
      .returning();

    // Reviews render on the reviewee's public profile.
    await notify(
      revieweeId,
      "video_arena_reviewed",
      "New work review",
      `${reviewerId === captainId ? "The Captain" : "Your hire"} left you a ${body.data.rating}-star review after the collaboration.`,
      `/creators-den/profile/${revieweeId}`,
      review.id,
    );

    // Hydrate reviewer identity (Clerk) + the project name so the response
    // matches the public ArenaReview shape the profile card renders.
    const [profiles, projectRows] = await Promise.all([
      resolveUserProfiles([reviewerId]),
      db
        .select()
        .from(tandemVideoProjectsTable)
        .where(eq(tandemVideoProjectsTable.id, application.projectId))
        .limit(1),
    ]);
    res.status(201).json(
      CreateArenaApplicationReviewResponse.parse({
        ...review,
        reviewerName: profiles[reviewerId]?.name ?? null,
        reviewerImageUrl: profiles[reviewerId]?.imageUrl ?? null,
        projectName: projectRows[0]?.name ?? null,
      }),
    );
  },
);

// GET /video/arena/reviews?userId=… — the public work reviews a profile has
// received (rating + note + role + project context). Reviews are public
// profile data — the reputation surface of the Arena — so any signed-in
// creator can read what a reviewee has received; they render on the
// reviewee's Creator Den profile. Only rows where the caller is the reviewee
// are returned, never reviews the caller gave.
router.get("/video/arena/reviews", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  // zod.coerce.string() turns an absent query param into the string
  // "undefined", so guard the raw value before parsing (empty/blank → 400).
  const rawUserId = typeof req.query.userId === "string" ? req.query.userId.trim() : "";
  if (!rawUserId) {
    res.status(400).json({ error: "A reviewee userId is required" });
    return;
  }
  const query = ListArenaReviewsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "A reviewee userId is required" });
    return;
  }

  const reviews = await db
    .select()
    .from(tandemArenaReviewsTable)
    .where(eq(tandemArenaReviewsTable.revieweeId, query.data.userId))
    .orderBy(desc(tandemArenaReviewsTable.createdAt));
  if (reviews.length === 0) {
    res.json(ListArenaReviewsResponse.parse([]));
    return;
  }

  // Hydrate reviewer identity (Clerk) + project names in one pass so the
  // profile card can render reviewer avatar/name and project context.
  const reviewerIds = [...new Set(reviews.map((review) => review.reviewerId))];
  const projectIds = [...new Set(reviews.map((review) => review.projectId))];
  const [profiles, projectRows] = await Promise.all([
    resolveUserProfiles(reviewerIds),
    db
      .select()
      .from(tandemVideoProjectsTable)
      .where(inArray(tandemVideoProjectsTable.id, projectIds)),
  ]);
  const projectNameById = new Map(projectRows.map((row) => [row.id, row.name]));

  res.json(
    ListArenaReviewsResponse.parse(
      reviews.map((review) => ({
        ...review,
        reviewerName: profiles[review.reviewerId]?.name ?? null,
        reviewerImageUrl: profiles[review.reviewerId]?.imageUrl ?? null,
        projectName: projectNameById.get(review.projectId) ?? null,
      })),
    ),
  );
});

// GET /video/arena/watches — the caller's own role watches (self-scoped).
router.get("/video/arena/watches", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const watches = await db
    .select()
    .from(tandemArenaWatchesTable)
    .where(eq(tandemArenaWatchesTable.userId, userId))
    .orderBy(desc(tandemArenaWatchesTable.createdAt));

  res.json(ListArenaWatchesResponse.parse(watches));
});

// POST /video/arena/watches — watch a role across the whole Arena (no
// channelId) or on one channel. Self-scoped; duplicate (user, role,
// channel-or-global) watches are a 409. NULLs are distinct in SQL, so the
// at-most-one rule is enforced here, not by a unique index.
router.post("/video/arena/watches", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const body = CreateArenaWatchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid watch — role is required and channelId is optional" });
    return;
  }
  if (!CONTENT_ROLES.includes(body.data.role as ArenaRole)) {
    res.status(400).json({ error: "Unknown role" });
    return;
  }

  const targetChannelId = body.data.channelId?.trim() || null;
  if (targetChannelId) {
    const [channel] = await db
      .select({ id: tandemChannelsTable.id })
      .from(tandemChannelsTable)
      .where(eq(tandemChannelsTable.id, targetChannelId))
      .limit(1);
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
  }

  const mine = await db
    .select()
    .from(tandemArenaWatchesTable)
    .where(
      and(
        eq(tandemArenaWatchesTable.userId, userId),
        eq(tandemArenaWatchesTable.role, body.data.role),
      ),
    );
  const duplicate = mine.find(
    (watch) => (watch.channelId ?? null) === targetChannelId,
  );
  if (duplicate) {
    res.status(409).json({ error: "You are already watching this role here" });
    return;
  }

  const [watch] = await db
    .insert(tandemArenaWatchesTable)
    .values({
      id: randomUUID(),
      userId,
      role: body.data.role,
      channelId: targetChannelId,
    })
    .returning();

  res.status(201).json(CreateArenaWatchResponse.parse(watch));
});

// DELETE /video/arena/watches/:watchId — stop watching (own watch only).
router.delete("/video/arena/watches/:watchId", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = DeleteArenaWatchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid watch id" });
    return;
  }

  const [deleted] = await db
    .delete(tandemArenaWatchesTable)
    .where(
      and(
        eq(tandemArenaWatchesTable.id, params.data.watchId),
        eq(tandemArenaWatchesTable.userId, userId),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Watch not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
