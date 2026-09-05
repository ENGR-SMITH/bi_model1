import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "arena-test-"));
process.env.TANDEM_MEDIA_DEMO = "1";
// The proxy-upload write test needs an "R2-configured" server so the request
// reaches the access gate (member-only) instead of short-circuiting on 503.
process.env.CF_ACCOUNT_ID = "test-account";
process.env.CF_R2_ACCESS_KEY = "test-key";
process.env.CF_R2_SECRET_KEY = "test-secret";
process.env.CF_R2_BUCKET = "test-bucket";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  clerkIdToName: {} as Record<string, string>,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUserList: async (params: { limit?: number; offset?: number; userId?: string[] }) => {
        const row = (id: string) => {
          const name = state.clerkIdToName[id] ?? "";
          const [first, ...rest] = name.split(" ");
          return {
            id,
            firstName: first || null,
            lastName: rest.join(" ") || null,
            username: null,
            emailAddresses: [],
            imageUrl: `https://img.example/${id}.png`,
          };
        };
        if (params.userId) return { data: params.userId.map(row) };
        const users = Object.keys(state.clerkIdToName).map(row);
        const offset = params.offset ?? 0;
        const limit = params.limit ?? users.length;
        return { data: users.slice(offset, offset + limit) };
      },
    },
  },
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import arenaRouter from "./arena";
import videoRouter from "./video";
import videoStorageRouter from "./video-storage";
import { clearUserNameCache } from "../lib/user-names";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", videoStorageRouter);
  app.use("/api", arenaRouter);
  return app;
}

const API = createApp();

const CAPTAIN = "user_captain1";
const CAPTAIN2 = "user_captain2";
const ALICE = "user_alice";
const BOB = "user_bob";

const PITCH = "Seeking a sharp editor to cut this channel's flagship video. We ship weekly.";

let seq = 0;

async function seedChannel(ownerId: string): Promise<string> {
  const id = `chan-${++seq}`;
  await state.db.insert(state.tables.tandemChannelsTable).values({
    id,
    ownerId,
    status: "CREATED",
    name: `${ownerId} Channel`,
  });
  return id;
}

async function seedProject(
  ownerId: string,
  opts: { channelId?: string | null; visibility?: string } = {},
): Promise<{ id: string; channelId: string | null }> {
  const id = `proj-${++seq}`;
  const channelId = opts.channelId !== undefined ? opts.channelId : await seedChannel(ownerId);
  await state.db.insert(state.tables.tandemVideoProjectsTable).values({
    id,
    channelId,
    ownerId,
    name: `Project ${id}`,
    status: "VAULT",
    visibility: opts.visibility ?? "PRIVATE",
  });
  // Real project creation also inserts the Captain as an ACTIVE CAPTAIN member.
  await state.db.insert(state.tables.tandemVideoMembersTable).values({
    id: `mem-${id}`,
    projectId: id,
    userId: ownerId,
    roles: ["CAPTAIN"],
    status: "ACTIVE",
  });
  return { id, channelId };
}

async function seedApplication(
  post: { id: string; projectId: string; role: string },
  applicantId: string,
  status = "PENDING",
) {
  await state.db.insert(state.tables.tandemArenaApplicationsTable).values({
    id: `arenaapp-${++seq}`,
    postId: post.id,
    projectId: post.projectId,
    role: post.role,
    applicantId,
    message: "I would love to bring my experience to this project.",
    status,
  });
}

/** POST an open role as `actor` and return the created post body. */
async function createPost(actor: string, projectId: string, role = "VIDEO", pitch = PITCH): Promise<any> {
  state.userId = actor;
  const res = await request(API).post("/api/video/arena/posts").send({ projectId, role, pitch });
  expect(res.status).toBe(201);
  return res.body;
}

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemArenaApplicationFilesTable);
  await state.db.delete(t.tandemArenaApplicationsTable);
  await state.db.delete(t.tandemArenaPostsTable);
  await state.db.delete(t.tandemArenaWatchesTable);
  await state.db.delete(t.tandemArenaReviewsTable);
  await state.db.delete(t.tandemArenaBlocksTable);
  await state.db.delete(t.tandemVideoNotificationsTable);
  await state.db.delete(t.tandemVideoFollowsTable);
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
  await state.db.delete(t.tandemChannelsTable);
  await state.db.delete(t.collaborationActivityEventsTable);
}

beforeEach(async () => {
  await resetDb();
  state.userId = null;
  clearUserNameCache();
  state.clerkIdToName = {
    [CAPTAIN]: "Ada Captain",
    [CAPTAIN2]: "Ben Boss",
    [ALICE]: "Alice Artist",
    [BOB]: "Bob Builder",
  };
});

afterEach(() => {
  state.userId = null;
});

describe("POST /video/arena/posts — publish an open role", () => {
  it("rejects without authentication", async () => {
    const res = await request(API).post("/api/video/arena/posts").send({ projectId: "p1", role: "VIDEO", pitch: PITCH });
    expect(res.status).toBe(401);
  });

  it("rejects when the caller does not own the project", async () => {
    const { id } = await seedProject(CAPTAIN);
    state.userId = CAPTAIN2;
    const res = await request(API).post("/api/video/arena/posts").send({ projectId: id, role: "VIDEO", pitch: PITCH });
    expect(res.status).toBe(403);
  });

  it("rejects projects that are not inside a channel", async () => {
    const { id } = await seedProject(CAPTAIN, { channelId: null });
    state.userId = CAPTAIN;
    const res = await request(API).post("/api/video/arena/posts").send({ projectId: id, role: "VIDEO", pitch: PITCH });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("channel");
  });

  it("rejects when the channel belongs to someone else", async () => {
    const otherChannel = await seedChannel(CAPTAIN2);
    const { id } = await seedProject(CAPTAIN, { channelId: otherChannel });
    state.userId = CAPTAIN;
    const res = await request(API).post("/api/video/arena/posts").send({ projectId: id, role: "VIDEO", pitch: PITCH });
    expect(res.status).toBe(403);
  });

  it("rejects an over-short pitch", async () => {
    const { id } = await seedProject(CAPTAIN);
    state.userId = CAPTAIN;
    const res = await request(API).post("/api/video/arena/posts").send({ projectId: id, role: "VIDEO", pitch: "too short" });
    expect(res.status).toBe(400);
  });

  it("creates an OPEN post with branding, empty counts, and an activity line", async () => {
    const { id: projectId } = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, projectId, "VIDEO");

    expect(post.status).toBe("OPEN");
    expect(post.role).toBe("VIDEO");
    expect(post.pitch).toBe(PITCH);
    expect(post.projectId).toBe(projectId);
    expect(post.posterName).toBe("Ada Captain");
    expect(post.posterImageUrl).toBe(`https://img.example/${CAPTAIN}.png`);
    expect(post.channelName).toBe(`${CAPTAIN} Channel`);
    expect(post.projectName).toBe(`Project ${projectId}`);
    expect(post.applicantCount).toBe(0);
    expect(post.myApplication).toBe("none");
    expect(post.totalApplications).toBe(0);

    const [row] = await state.db
      .select()
      .from(state.tables.tandemArenaPostsTable)
      .where(eq(state.tables.tandemArenaPostsTable.id, post.id));
    expect(row.status).toBe("OPEN");
    expect(row.postedBy).toBe(CAPTAIN);

    const activity = await state.db
      .select()
      .from(state.tables.collaborationActivityEventsTable)
      .where(eq(state.tables.collaborationActivityEventsTable.projectId, projectId));
    expect(activity.map((e: any) => e.eventType)).toContain("arena_post_opened");
  });

  it("allows one OPEN post per (project, role) — 409 on duplicates, other roles fine", async () => {
    const { id } = await seedProject(CAPTAIN);
    await createPost(CAPTAIN, id, "VIDEO");

    state.userId = CAPTAIN;
    const dup = await request(API).post("/api/video/arena/posts").send({ projectId: id, role: "VIDEO", pitch: PITCH });
    expect(dup.status).toBe(409);

    const other = await request(API).post("/api/video/arena/posts").send({ projectId: id, role: "THUMBNAIL", pitch: PITCH });
    expect(other.status).toBe(201);
  });
});

describe("GET /video/arena/posts — the board", () => {
  it("rejects without authentication", async () => {
    const res = await request(API).get("/api/video/arena/posts");
    expect(res.status).toBe(401);
  });

  it("lists only OPEN posts across platforms with branding and counts", async () => {
    const a = await seedProject(CAPTAIN);
    const b = await seedProject(CAPTAIN2);
    const postA = await createPost(CAPTAIN, a.id, "VIDEO");
    const postB = await createPost(CAPTAIN2, b.id, "AUDIO");
    await seedProject(CAPTAIN); // untouched project with no post

    // CLOSED + FILLED posts stay off the public board.
    await state.db
      .update(state.tables.tandemArenaPostsTable)
      .set({ status: "CLOSED" })
      .where(eq(state.tables.tandemArenaPostsTable.id, postA.id));
    await state.db.insert(state.tables.tandemArenaPostsTable).values({
      id: `arena-filled-${++seq}`,
      channelId: b.channelId!,
      projectId: b.id,
      role: "SCRIPT",
      pitch: PITCH,
      status: "FILLED",
      postedBy: CAPTAIN2,
    });

    state.userId = ALICE;
    const res = await request(API).get("/api/video/arena/posts");
    expect(res.status).toBe(200);
    const ids = res.body.map((p: any) => p.id);
    expect(ids).toContain(postB.id);
    expect(ids).not.toContain(postA.id);
    expect(ids).not.toContain(`arena-filled-${seq}`);

    const audio = res.body.find((p: any) => p.id === postB.id);
    expect(audio.posterName).toBe("Ben Boss");
    expect(audio.applicantCount).toBe(0);
    expect(audio.myApplication).toBe("none");
  });

  it("filters by role and by channel", async () => {
    const a = await seedProject(CAPTAIN);
    const b = await seedProject(CAPTAIN2);
    const videoPost = await createPost(CAPTAIN, a.id, "VIDEO");
    await createPost(CAPTAIN2, b.id, "AUDIO");

    state.userId = ALICE;
    const byRole = await request(API).get("/api/video/arena/posts").query({ role: "VIDEO" });
    expect(byRole.status).toBe(200);
    expect(byRole.body.map((p: any) => p.id)).toEqual([videoPost.id]);

    const byChannel = await request(API).get("/api/video/arena/posts").query({ channelId: b.channelId });
    expect(byChannel.body.map((p: any) => p.role)).toEqual(["AUDIO"]);
  });

  it("reports the live applicant count and the caller's own application state", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    await seedApplication(post, ALICE);
    await seedApplication(post, BOB);

    state.userId = ALICE;
    const res = await request(API).get("/api/video/arena/posts");
    const row = res.body.find((p: any) => p.id === post.id);
    expect(row.applicantCount).toBe(2);
    expect(row.myApplication).toBe("pending");

    // Another signed-in viewer sees the same count but no application of their own.
    state.userId = CAPTAIN2;
    const other = await request(API).get("/api/video/arena/posts");
    expect(other.body.find((p: any) => p.id === post.id).myApplication).toBe("none");
  });

  it("sorts by most_applied (then newest)", async () => {
    const a = await seedProject(CAPTAIN);
    const b = await seedProject(CAPTAIN);
    const lonely = await createPost(CAPTAIN, a.id, "VIDEO");
    const popular = await createPost(CAPTAIN, b.id, "VIDEO");
    await seedApplication(popular, ALICE);
    await seedApplication(popular, BOB);
    await seedApplication(lonely, ALICE);

    state.userId = ALICE;
    const res = await request(API).get("/api/video/arena/posts").query({ sort: "most_applied" });
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(popular.id);
    expect(res.body[0].applicantCount).toBe(2);
    expect(res.body[1].id).toBe(lonely.id);
  });

  it("orders followed captains first", async () => {
    const a = await seedProject(CAPTAIN);
    const b = await seedProject(CAPTAIN2);
    await createPost(CAPTAIN2, b.id, "VIDEO"); // older post from a followed captain
    await createPost(CAPTAIN, a.id, "VIDEO"); // newer post from a stranger

    await state.db.insert(state.tables.tandemVideoFollowsTable).values({
      id: `follow-${++seq}`,
      followerId: ALICE,
      followingId: CAPTAIN2,
    });

    state.userId = ALICE;
    const res = await request(API).get("/api/video/arena/posts").query({ followed: 1 });
    expect(res.status).toBe(200);
    expect(res.body[0].postedBy).toBe(CAPTAIN2);
  });

  it("?mine=1 returns the caller's own posts in every status", async () => {
    const a = await seedProject(CAPTAIN);
    const b = await seedProject(CAPTAIN2);
    const own = await createPost(CAPTAIN, a.id, "VIDEO");
    await createPost(CAPTAIN2, b.id, "AUDIO");
    await state.db
      .update(state.tables.tandemArenaPostsTable)
      .set({ status: "CLOSED" })
      .where(eq(state.tables.tandemArenaPostsTable.id, own.id));

    state.userId = CAPTAIN;
    const res = await request(API).get("/api/video/arena/posts").query({ mine: 1 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(own.id);
    expect(res.body[0].status).toBe("CLOSED");
  });
});

describe("GET /video/arena/posts/:postId — post detail", () => {
  it("returns 404 for a missing post", async () => {
    state.userId = ALICE;
    const res = await request(API).get("/api/video/arena/posts/nope");
    expect(res.status).toBe(404);
  });

  it("is readable by any signed-in user and reports the live count", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    await seedApplication(post, BOB);

    state.userId = ALICE;
    const res = await request(API).get(`/api/video/arena/posts/${post.id}`);
    expect(res.status).toBe(200);
    expect(res.body.applicantCount).toBe(1);
    expect(res.body.myApplication).toBe("none");
    // Non-Captain viewers never see the total history.
    expect(res.body.totalApplications).toBe(0);
    // No one has filled the role yet, so there is no hire profile.
    expect(res.body.filledBy).toBeNull();
  });

  it("shows the Captain the total application history", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    await seedApplication(post, ALICE);
    await seedApplication(post, BOB);
    await state.db
      .update(state.tables.tandemArenaApplicationsTable)
      .set({ status: "REJECTED", decidedBy: CAPTAIN, decidedAt: new Date() })
      .where(eq(state.tables.tandemArenaApplicationsTable.applicantId, BOB));

    state.userId = CAPTAIN;
    const res = await request(API).get(`/api/video/arena/posts/${post.id}`);
    expect(res.status).toBe(200);
    expect(res.body.applicantCount).toBe(1); // ALICE still pending
    expect(res.body.totalApplications).toBe(2); // ever received
    expect(res.body.myApplication).toBe("none");
  });
});

describe("PATCH /video/arena/posts/:postId — close/reopen/pitch", () => {
  it("rejects non-Captains and unknown posts", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");

    state.userId = ALICE;
    const forbidden = await request(API).patch(`/api/video/arena/posts/${post.id}`).send({ status: "CLOSED" });
    expect(forbidden.status).toBe(403);

    state.userId = CAPTAIN;
    const missing = await request(API).patch("/api/video/arena/posts/nope").send({ status: "CLOSED" });
    expect(missing.status).toBe(404);
  });

  it("rejects an empty update", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    state.userId = CAPTAIN;
    const res = await request(API).patch(`/api/video/arena/posts/${post.id}`).send({});
    expect(res.status).toBe(400);
  });

  it("closes an OPEN post, notifying PENDING applicants and recording activity", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    await seedApplication(post, ALICE);
    await seedApplication(post, BOB);
    await seedApplication(post, CAPTAIN2);

    state.userId = CAPTAIN;
    const res = await request(API).patch(`/api/video/arena/posts/${post.id}`).send({ status: "CLOSED" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("CLOSED");

    const notified = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable)
      .where(eq(state.tables.tandemVideoNotificationsTable.category, "video_arena_closed"));
    expect(notified.map((n: any) => n.recipientId).sort()).toEqual([ALICE, BOB, CAPTAIN2].sort());
    expect(notified[0].deepLink).toBe(`/creators-den/arena/posts/${post.id}`);

    const activity = await state.db
      .select()
      .from(state.tables.collaborationActivityEventsTable)
      .where(eq(state.tables.collaborationActivityEventsTable.eventType, "arena_post_closed"));
    expect(activity.length).toBe(1);
  });

  it("reopens a CLOSED post", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    state.userId = CAPTAIN;
    const closed = await request(API).patch(`/api/video/arena/posts/${post.id}`).send({ status: "CLOSED" });
    expect(closed.status).toBe(200);
    const reopened = await request(API).patch(`/api/video/arena/posts/${post.id}`).send({ status: "OPEN" });
    expect(reopened.status).toBe(200);
    expect(reopened.body.status).toBe("OPEN");
  });

  it("edits the pitch while OPEN but not once closed", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    state.userId = CAPTAIN;

    const edit = await request(API)
      .patch(`/api/video/arena/posts/${post.id}`)
      .send({ pitch: "Updated pitch — we now need someone experienced with long-form docs." });
    expect(edit.status).toBe(200);
    expect(edit.body.pitch).toContain("Updated pitch");

    await request(API).patch(`/api/video/arena/posts/${post.id}`).send({ status: "CLOSED" });
    const late = await request(API)
      .patch(`/api/video/arena/posts/${post.id}`)
      .send({ pitch: "Trying to sneak in an edit after close." });
    expect(late.status).toBe(409);
  });

  it("never mutates a FILLED post", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    await state.db
      .update(state.tables.tandemArenaPostsTable)
      .set({ status: "FILLED" })
      .where(eq(state.tables.tandemArenaPostsTable.id, post.id));

    state.userId = CAPTAIN;
    const res = await request(API).patch(`/api/video/arena/posts/${post.id}`).send({ status: "OPEN" });
    expect(res.status).toBe(409);
  });
});

describe("role watches — GET/POST/DELETE /video/arena/watches", () => {
  it("rejects without authentication", async () => {
    for (const method of ["get", "post", "delete"] as const) {
      const res = await request(API)[method](
        method === "delete" ? "/api/video/arena/watches/nope" : "/api/video/arena/watches",
      );
      expect(res.status).toBe(401);
    }
  });

  it("lists the caller's own watches (empty → grows)", async () => {
    state.userId = ALICE;
    const empty = await request(API).get("/api/video/arena/watches");
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const global = await request(API).post("/api/video/arena/watches").send({ role: "VIDEO" });
    expect(global.status).toBe(201);
    expect(global.body.role).toBe("VIDEO");
    expect(global.body.channelId).toBeNull();
    expect(global.body.userId).toBeUndefined(); // self-scoped rows never leak owner ids

    const channelId = await seedChannel(CAPTAIN2);
    const scoped = await request(API)
      .post("/api/video/arena/watches")
      .send({ role: "VIDEO", channelId });
    expect(scoped.status).toBe(201);
    expect(scoped.body.channelId).toBe(channelId);

    const list = await request(API).get("/api/video/arena/watches");
    expect(list.body.length).toBe(2);
    expect(list.body.map((w: any) => w.channelId ?? "ALL").sort()).toEqual(["ALL", channelId]);

    // Another user never sees ALICE's watches.
    state.userId = BOB;
    const theirs = await request(API).get("/api/video/arena/watches");
    expect(theirs.body).toEqual([]);
  });

  it("rejects unknown roles, unknown channels, and duplicate watches", async () => {
    state.userId = ALICE;
    const badRole = await request(API).post("/api/video/arena/watches").send({ role: "DIRECTOR" });
    expect(badRole.status).toBe(400);

    const missingChannel = await request(API)
      .post("/api/video/arena/watches")
      .send({ role: "AUDIO", channelId: "nope" });
    expect(missingChannel.status).toBe(404);

    await request(API).post("/api/video/arena/watches").send({ role: "SCRIPT" });
    const dup = await request(API).post("/api/video/arena/watches").send({ role: "SCRIPT" });
    expect(dup.status).toBe(409);

    // Same role on a different channel (or vice versa) is a separate watch.
    const channelId = await seedChannel(CAPTAIN2);
    const different = await request(API)
      .post("/api/video/arena/watches")
      .send({ role: "SCRIPT", channelId });
    expect(different.status).toBe(201);
  });

  it("deletes only the caller's own watch", async () => {
    const a = await seedChannel(CAPTAIN2);
    state.userId = ALICE;
    const created = await request(API)
      .post("/api/video/arena/watches")
      .send({ role: "VIDEO", channelId: a });
    const watchId = created.body.id;

    // Someone else cannot delete it (self-scoped).
    state.userId = BOB;
    const forbidden = await request(API).delete(`/api/video/arena/watches/${watchId}`);
    expect(forbidden.status).toBe(404);

    state.userId = ALICE;
    const gone = await request(API).delete(`/api/video/arena/watches/${watchId}`);
    expect(gone.status).toBe(204);

    const missing = await request(API).delete(`/api/video/arena/watches/${watchId}`);
    expect(missing.status).toBe(404);
  });
});

describe("notify-on-publish — role watch fan-out", () => {
  async function watch(userId: string, role: string, channelId?: string): Promise<void> {
    await state.db.insert(state.tables.tandemArenaWatchesTable).values({
      id: `watch-${++seq}`,
      userId,
      role,
      channelId: channelId ?? null,
    });
  }

  it("notifies matching watchers once each, never the poster or non-matching roles", async () => {
    const { id: projectId, channelId } = await seedProject(CAPTAIN);
    // ALICE holds BOTH a global VIDEO watch and a VIDEO watch on this channel.
    await watch(ALICE, "VIDEO");
    await watch(ALICE, "VIDEO", channelId!);
    // BOB watches VIDEO only on this channel; CAPTAIN2 watches AUDIO globally.
    await watch(BOB, "VIDEO", channelId!);
    await watch(CAPTAIN2, "AUDIO");
    // The poster watches VIDEO globally — must not self-notify.
    await watch(CAPTAIN, "VIDEO");

    const post = await createPost(CAPTAIN, projectId, "VIDEO");

    const notifications = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable)
      .where(eq(state.tables.tandemVideoNotificationsTable.category, "video_arena_watch"));

    // ALICE + BOB exactly once each; CAPTAIN2 (wrong role) and CAPTAIN (poster) excluded.
    expect(notifications.map((n: any) => n.recipientId).sort()).toEqual([ALICE, BOB]);
    for (const n of notifications) {
      expect(n.resourceId).toBe(post.id);
      expect(n.deepLink).toBe(`/creators-den/arena/posts/${post.id}`);
      expect(n.title).toContain("video");
    }
  });

  it("a global watch fires for every matching channel's posts", async () => {
    const x = await seedProject(CAPTAIN);
    const y = await seedProject(CAPTAIN2);
    await watch(ALICE, "THUMBNAIL");

    const postX = await createPost(CAPTAIN, x.id, "THUMBNAIL");
    const postY = await createPost(CAPTAIN2, y.id, "THUMBNAIL");

    const notifications = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable)
      .where(eq(state.tables.tandemVideoNotificationsTable.category, "video_arena_watch"));
    expect(notifications.map((n: any) => n.resourceId).sort()).toEqual([postX.id, postY.id].sort());
  });
});

describe("Arena access widening — resolveProjectAccess + viewerAccess", () => {
  it("gives a signed-in non-member read-only access (applicant) while a post is OPEN", async () => {
    const a = await seedProject(CAPTAIN); // PRIVATE by default
    await createPost(CAPTAIN, a.id, "VIDEO");

    state.userId = ALICE;
    const res = await request(API).get(`/api/video/projects/${a.id}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerAccess).toBe("applicant");
    expect(res.body.myRoles).toEqual([]);
  });

  it("closes the window when the post is closed or never existed", async () => {
    const withPost = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, withPost.id, "VIDEO");
    const withoutPost = await seedProject(CAPTAIN2);

    state.userId = ALICE;
    const open = await request(API).get(`/api/video/projects/${withPost.id}`);
    expect(open.body.viewerAccess).toBe("applicant");

    state.userId = CAPTAIN;
    await request(API).patch(`/api/video/arena/posts/${post.id}`).send({ status: "CLOSED" });

    state.userId = ALICE;
    const closed = await request(API).get(`/api/video/projects/${withPost.id}`);
    expect(closed.status).toBe(403);

    const never = await request(API).get(`/api/video/projects/${withoutPost.id}`);
    expect(never.status).toBe(403);
  });

  it("keeps PUBLIC projects resolving as public for non-members", async () => {
    const pub = await seedProject(CAPTAIN, { visibility: "PUBLIC" });
    state.userId = ALICE;
    const res = await request(API).get(`/api/video/projects/${pub.id}`);
    expect(res.status).toBe(200);
    expect(res.body.viewerAccess).toBe("public");
    expect(res.body.myRoles).toEqual([]);
  });

  it("keeps members and Captains on member access", async () => {
    const a = await seedProject(CAPTAIN);
    await state.db.insert(state.tables.tandemVideoMembersTable).values({
      id: `mem-alice-${++seq}`,
      projectId: a.id,
      userId: ALICE,
      roles: ["VIDEO"],
      status: "ACTIVE",
    });

    state.userId = ALICE;
    const member = await request(API).get(`/api/video/projects/${a.id}`);
    expect(member.body.viewerAccess).toBe("member");
    expect(member.body.myRoles).toEqual(["VIDEO"]);

    state.userId = CAPTAIN;
    const captain = await request(API).get(`/api/video/projects/${a.id}`);
    expect(captain.body.viewerAccess).toBe("member");
  });

  it("never lets an applicant write — proxy uploads stay member-only", async () => {
    const a = await seedProject(CAPTAIN);
    await createPost(CAPTAIN, a.id, "VIDEO");

    // Applicant can read the project detail...
    state.userId = ALICE;
    const detail = await request(API).get(`/api/video/projects/${a.id}`);
    expect(detail.status).toBe(200);

    // ...but the presigned proxy-upload write is refused.
    const mint = await request(API)
      .post(`/api/video/projects/${a.id}/assets/nope/proxy-upload-url`)
      .send({ fileSize: 1024 });
    expect(mint.status).toBe(403);
  });
});

describe("auditions — POST applications (multipart)", () => {
  const MESSAGE = "I've cut 40+ long-form videos for creators and can start immediately with your workflow.";

  async function apply(applicantId: string, postId: string): Promise<any> {
    state.userId = applicantId;
    return request(API)
      .post(`/api/video/arena/posts/${postId}/applications`)
      .field("message", MESSAGE);
  }

  it("creates a PENDING audition with documents and notifies the Captain", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");

    state.userId = ALICE;
    const res = await request(API)
      .post(`/api/video/arena/posts/${post.id}/applications`)
      .field("message", MESSAGE)
      .attach("files", Buffer.from("fake pdf bytes"), "showreel.pdf")
      .attach("files", Buffer.from("cover letter text"), "cover-letter.txt");
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.applicantId).toBe(ALICE);
    expect(res.body.applicantName).toBe("Alice Artist");
    expect(res.body.applicantImageUrl).toBe(`https://img.example/${ALICE}.png`);
    expect(res.body.message).toBe(MESSAGE);
    expect(res.body.files.length).toBe(2);
    expect(res.body.files.map((f: any) => f.fileName).sort()).toEqual(["cover-letter.txt", "showreel.pdf"]);
    expect(res.body.files[0].storageKey).toBeUndefined(); // metadata only — never the on-disk name

    // The live board count increments immediately.
    state.userId = BOB;
    const board = await request(API).get("/api/video/arena/posts");
    expect(board.body.find((p: any) => p.id === post.id).applicantCount).toBe(1);

    // The Captain is notified with a link to the post.
    const notices = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable)
      .where(eq(state.tables.tandemVideoNotificationsTable.category, "video_arena_applied"));
    expect(notices.length).toBe(1);
    expect(notices[0].recipientId).toBe(CAPTAIN);
    expect(notices[0].deepLink).toBe(`/creators-den/arena/posts/${post.id}`);
  });

  it("allows a message-only audition (no documents)", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "AUDIO");
    const res = await apply(BOB, post.id);
    expect(res.status).toBe(201);
    expect(res.body.files).toEqual([]);
  });

  it("rejects applications to closed or filled posts", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    state.userId = CAPTAIN;
    await request(API).patch(`/api/video/arena/posts/${post.id}`).send({ status: "CLOSED" });
    const res = await apply(ALICE, post.id);
    expect(res.status).toBe(409);
  });

  it("rejects the Captain's own post and current project members", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");

    const own = await apply(CAPTAIN, post.id);
    expect(own.status).toBe(409);

    // ALICE joins the project team, then tries to audition for the open seat.
    await state.db.insert(state.tables.tandemVideoMembersTable).values({
      id: `mem-alice-${++seq}`,
      projectId: a.id,
      userId: ALICE,
      roles: ["SCRIPT"],
      status: "ACTIVE",
    });
    const member = await apply(ALICE, post.id);
    expect(member.status).toBe(409);
  });

  it("blocks a duplicate PENDING audition (409)", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    expect((await apply(ALICE, post.id)).status).toBe(201);
    const dup = await apply(ALICE, post.id);
    expect(dup.status).toBe(409);
  });

  it("blocks a user blacklisted by this Captain (403)", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    await state.db.insert(state.tables.tandemArenaBlocksTable).values({
      id: `arena-block-${++seq}`,
      captainId: CAPTAIN,
      applicantId: ALICE,
    });
    const res = await apply(ALICE, post.id);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("blocked");
  });

  it("enforces the per-week apply cap (429) — rejections never refund a slot", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    // ALICE already burned all 10 weekly slots on this same post (rejected rows).
    for (let i = 0; i < 10; i += 1) {
      await seedApplication(post, ALICE, "REJECTED");
    }
    const res = await apply(ALICE, post.id);
    expect(res.status).toBe(429);
  });

  it("validates the message length and the upload shape", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");

    state.userId = ALICE;
    const short = await request(API)
      .post(`/api/video/arena/posts/${post.id}/applications`)
      .field("message", "too short");
    expect(short.status).toBe(400);

    const tooMany = await request(API)
      .post(`/api/video/arena/posts/${post.id}/applications`)
      .field("message", MESSAGE)
      .attach("files", Buffer.from("a"), "a.pdf")
      .attach("files", Buffer.from("b"), "b.pdf")
      .attach("files", Buffer.from("c"), "c.pdf")
      .attach("files", Buffer.from("d"), "d.pdf");
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toContain("at most 3");

    const badType = await request(API)
      .post(`/api/video/arena/posts/${post.id}/applications`)
      .field("message", MESSAGE)
      .attach("files", Buffer.from("MZ..."), { filename: "tool.exe", contentType: "application/x-msdownload" });
    expect(badType.status).toBe(400);
    expect(badType.body.error).toContain("Unsupported document type");
  });
});

describe("auditions — lists, detail, and document streaming", () => {
  const MESSAGE = "I've cut 40+ long-form videos for creators and can start immediately with your workflow.";

  async function applyWithFile(applicantId: string, postId: string): Promise<any> {
    state.userId = applicantId;
    return request(API)
      .post(`/api/video/arena/posts/${postId}/applications`)
      .field("message", MESSAGE)
      .attach("files", Buffer.from("fake pdf bytes"), "showreel.pdf");
  }

  it("shows the Captain every audition with profiles and documents", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    const aliceApp = await applyWithFile(ALICE, post.id);
    const bobApp = await applyWithFile(BOB, post.id);

    state.userId = BOB;
    const forbidden = await request(API).get(`/api/video/arena/posts/${post.id}/applications`);
    expect(forbidden.status).toBe(403);

    state.userId = CAPTAIN;
    const list = await request(API).get(`/api/video/arena/posts/${post.id}/applications`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(2);
    expect(list.body.map((x: any) => x.id).sort()).toEqual([aliceApp.body.id, bobApp.body.id].sort());
    expect(list.body.map((x: any) => x.applicantName).sort()).toEqual(["Alice Artist", "Bob Builder"]);
    // Both applicants attached one document each — metadata rides the list.
    for (const row of list.body) {
      expect(row.files.length).toBe(1);
      expect(row.files[0].fileName).toBe("showreel.pdf");
      expect(row.files[0].storageKey).toBeUndefined();
    }
  });

  it("My Auditions returns only the caller's own applications across posts", async () => {
    const a = await seedProject(CAPTAIN);
    const b = await seedProject(CAPTAIN2);
    const postA = await createPost(CAPTAIN, a.id, "VIDEO");
    const postB = await createPost(CAPTAIN2, b.id, "AUDIO");
    const aliceApp = await applyWithFile(ALICE, postA.id);
    const mineB = await applyWithFile(ALICE, postB.id);
    await applyWithFile(BOB, postB.id);

    state.userId = ALICE;
    const mine = await request(API).get("/api/video/arena/applications/mine");
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBe(2);
    expect(mine.body.map((x: any) => x.postId).sort()).toEqual([postA.id, postB.id].sort());
    expect(mine.body.find((x: any) => x.id === mineB.body.id).status).toBe("PENDING");
    expect(mine.body.find((x: any) => x.id === aliceApp.body.id).files.length).toBe(1);

    // Detail: applicant + the post's Captain yes; a stranger gets 404 (existence hidden).
    state.userId = ALICE;
    const applicantView = await request(API).get(`/api/video/arena/applications/${mineB.body.id}`);
    expect(applicantView.status).toBe(200);
    expect(applicantView.body.applicantName).toBe("Alice Artist");

    state.userId = CAPTAIN2; // CAPTAIN2 owns postB
    const ownerView = await request(API).get(`/api/video/arena/applications/${mineB.body.id}`);
    expect(ownerView.status).toBe(200);

    state.userId = CAPTAIN; // unrelated Captain — existence stays hidden
    const stranger = await request(API).get(`/api/video/arena/applications/${mineB.body.id}`);
    expect(stranger.status).toBe(404);
  });

  it("streams a document to the applicant and the Captain only", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    const app = await applyWithFile(ALICE, post.id);
    const fileId = app.body.files[0].id;

    for (const viewer of [ALICE, CAPTAIN]) {
      state.userId = viewer;
      const res = await request(API).get(`/api/video/arena/applications/${app.body.id}/files/${fileId}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(Buffer.from(res.body).toString()).toBe("fake pdf bytes");
    }

    state.userId = BOB;
    const stranger = await request(API).get(`/api/video/arena/applications/${app.body.id}/files/${fileId}`);
    expect(stranger.status).toBe(404);
  });
});

describe("auditions — accept / reject / withdraw decisions", () => {
  const MESSAGE = "I've cut 40+ long-form videos for creators and can start immediately with your workflow.";

  async function apply(applicantId: string, postId: string): Promise<any> {
    state.userId = applicantId;
    return request(API)
      .post(`/api/video/arena/posts/${postId}/applications`)
      .field("message", MESSAGE);
  }

  it("accepting hires the applicant atomically and auto-declines the rest", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    const aliceApp = await apply(ALICE, post.id);
    const bobApp = await apply(BOB, post.id);
    const carlApp = await apply("user_creator3", post.id);

    // Only the Captain can decide.
    state.userId = BOB;
    const forbidden = await request(API).post(`/api/video/arena/applications/${aliceApp.body.id}/accept`);
    expect(forbidden.status).toBe(403);

    state.userId = CAPTAIN;
    const accepted = await request(API).post(`/api/video/arena/applications/${aliceApp.body.id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("ACCEPTED");
    expect(accepted.body.decidedBy).toBe(CAPTAIN);

    // The post filled and the remaining PENDING auditions were auto-declined.
    const [postRow] = await state.db
      .select()
      .from(state.tables.tandemArenaPostsTable)
      .where(eq(state.tables.tandemArenaPostsTable.id, post.id));
    expect(postRow.status).toBe("FILLED");

    const [bobRow] = await state.db
      .select()
      .from(state.tables.tandemArenaApplicationsTable)
      .where(eq(state.tables.tandemArenaApplicationsTable.id, bobApp.body.id));
    expect(bobRow.status).toBe("REJECTED");
    expect(bobRow.decidedBy).toBe(CAPTAIN);
    const [carlRow] = await state.db
      .select()
      .from(state.tables.tandemArenaApplicationsTable)
      .where(eq(state.tables.tandemArenaApplicationsTable.id, carlApp.body.id));
    expect(carlRow.status).toBe("REJECTED");

    // ALICE is now an ACTIVE member holding the role + a channel editor.
    const [memberRow] = await state.db
      .select()
      .from(state.tables.tandemVideoMembersTable)
      .where(
        and(
          eq(state.tables.tandemVideoMembersTable.projectId, a.id),
          eq(state.tables.tandemVideoMembersTable.userId, ALICE),
        ),
      );
    expect(memberRow.status).toBe("ACTIVE");
    expect(memberRow.roles).toContain("VIDEO");

    const [channelMember] = await state.db
      .select()
      .from(state.tables.tandemChannelMembersTable)
      .where(
        and(
          eq(state.tables.tandemChannelMembersTable.channelId, a.channelId!),
          eq(state.tables.tandemChannelMembersTable.userId, ALICE),
        ),
      );
    expect(channelMember.role).toBe("EDITOR");

    // Notifications: hire + auto-declines.
    const categories = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable);
    expect(categories.filter((n: any) => n.category === "video_arena_accepted" && n.recipientId === ALICE).length).toBe(1);
    expect(categories.filter((n: any) => n.category === "video_arena_rejected").length).toBe(2);
    const acceptedNotice = categories.find((n: any) => n.category === "video_arena_accepted");
    expect(acceptedNotice.deepLink).toBe(`/creators-den/channels/${a.channelId}/projects/${a.id}`);

    // The fill lands on the project timeline.
    const activity = await state.db
      .select()
      .from(state.tables.collaborationActivityEventsTable)
      .where(eq(state.tables.collaborationActivityEventsTable.eventType, "arena_post_filled"));
    expect(activity.length).toBe(1);
    expect(activity[0].summary).toContain("Alice Artist");

    // ALICE now opens the project as a full member.
    state.userId = ALICE;
    const detail = await request(API).get(`/api/video/projects/${a.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.viewerAccess).toBe("member");
    expect(detail.body.myRoles).toContain("VIDEO");

    // The declined applicant opens the post and sees who filled the role.
    state.userId = BOB;
    const postDetail = await request(API).get(`/api/video/arena/posts/${post.id}`);
    expect(postDetail.status).toBe(200);
    expect(postDetail.body.status).toBe("FILLED");
    expect(postDetail.body.filledBy).toEqual({
      id: ALICE,
      name: "Alice Artist",
      imageUrl: `https://img.example/${ALICE}.png`,
    });
  });

  it("reactivates an existing member row instead of duplicating it", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "SCRIPT");
    await state.db.insert(state.tables.tandemVideoMembersTable).values({
      id: `mem-lapsed-${++seq}`,
      projectId: a.id,
      userId: ALICE,
      roles: ["THUMBNAIL"],
      status: "INACTIVE",
    });
    const aliceApp = await apply(ALICE, post.id);

    state.userId = CAPTAIN;
    const res = await request(API).post(`/api/video/arena/applications/${aliceApp.body.id}/accept`);
    expect(res.status).toBe(200);

    const members = await state.db
      .select()
      .from(state.tables.tandemVideoMembersTable)
      .where(
        and(
          eq(state.tables.tandemVideoMembersTable.projectId, a.id),
          eq(state.tables.tandemVideoMembersTable.userId, ALICE),
        ),
      );
    expect(members.length).toBe(1);
    expect(members[0].status).toBe("ACTIVE");
    expect(members[0].roles.sort()).toEqual(["SCRIPT", "THUMBNAIL"]);
  });

  it("rejects only a PENDING audition and notifies the applicant", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    const aliceApp = await apply(ALICE, post.id);

    state.userId = CAPTAIN;
    const rejected = await request(API).post(`/api/video/arena/applications/${aliceApp.body.id}/reject`);
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("REJECTED");
    expect(rejected.body.decidedAt).toBeTruthy();

    // The applicant can audition again — only PENDING blocks a duplicate.
    state.userId = ALICE;
    const reapplied = await apply(ALICE, post.id);
    expect(reapplied.status).toBe(201);

    const notices = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable)
      .where(eq(state.tables.tandemVideoNotificationsTable.category, "video_arena_rejected"));
    expect(notices.map((n: any) => n.recipientId)).toContain(ALICE);

    // A second reject on the resolved row is a conflict.
    state.userId = CAPTAIN;
    const again = await request(API).post(`/api/video/arena/applications/${aliceApp.body.id}/reject`);
    expect(again.status).toBe(409);
  });

  it("withdraws a PENDING audition, dropping the live count and notifying the Captain", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    const aliceApp = await apply(ALICE, post.id);
    await apply(BOB, post.id);

    // A stranger cannot withdraw someone else's audition.
    state.userId = BOB;
    const stranger = await request(API).post(`/api/video/arena/applications/${aliceApp.body.id}/withdraw`);
    expect(stranger.status).toBe(404);

    state.userId = ALICE;
    const withdrawn = await request(API).post(`/api/video/arena/applications/${aliceApp.body.id}/withdraw`);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.status).toBe("WITHDRAWN");

    // The board's live count drops to just BOB.
    state.userId = BOB;
    const board = await request(API).get("/api/video/arena/posts");
    expect(board.body.find((p: any) => p.id === post.id).applicantCount).toBe(1);

    const notices = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable)
      .where(eq(state.tables.tandemVideoNotificationsTable.category, "video_arena_withdrawn"));
    expect(notices.map((n: any) => n.recipientId)).toContain(CAPTAIN);

    // Withdrawing a resolved audition is a conflict; My Auditions shows it.
    state.userId = ALICE;
    const again = await request(API).post(`/api/video/arena/applications/${aliceApp.body.id}/withdraw`);
    expect(again.status).toBe(409);
    const mine = await request(API).get("/api/video/arena/applications/mine");
    expect(mine.body.find((x: any) => x.id === aliceApp.body.id).status).toBe("WITHDRAWN");
  });
});

describe("mutual work reviews — POST /applications/:id/review", () => {
  const MESSAGE = "I've cut 40+ long-form videos for creators and can start immediately with your workflow.";

  async function apply(applicantId: string, postId: string): Promise<any> {
    state.userId = applicantId;
    return request(API)
      .post(`/api/video/arena/posts/${postId}/applications`)
      .field("message", MESSAGE);
  }

  async function hireAlice(ownerId: string, projectId: string, post: any): Promise<any> {
    const app = await apply(ALICE, post.id);
    state.userId = ownerId;
    const accepted = await request(API).post(`/api/video/arena/applications/${app.body.id}/accept`);
    expect(accepted.status).toBe(200);
    return app.body.id;
  }

  it("rejects unauthenticated, invalid bodies, and unknown applications", async () => {
    state.userId = null;
    expect((await request(API).post("/api/video/arena/applications/x/review").send({ rating: 5, note: "ok" })).status).toBe(401);

    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    const applicationId = await hireAlice(CAPTAIN, a.id, post);

    state.userId = CAPTAIN;
    const tooLow = await request(API).post(`/api/video/arena/applications/${applicationId}/review`).send({ rating: 0, note: "ok" });
    expect(tooLow.status).toBe(400);
    const tooHigh = await request(API).post(`/api/video/arena/applications/${applicationId}/review`).send({ rating: 6, note: "ok" });
    expect(tooHigh.status).toBe(400);
    const tooLong = await request(API)
      .post(`/api/video/arena/applications/${applicationId}/review`)
      .send({ rating: 5, note: "x".repeat(501) });
    expect(tooLong.status).toBe(400);

    const missing = await request(API).post("/api/video/arena/applications/nope/review").send({ rating: 5, note: "ok" });
    expect(missing.status).toBe(404);
  });

  it("only the two participants of a completed hire can review", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    const pendingApp = await apply(ALICE, post.id);
    await apply(BOB, post.id);

    // A hire that never happened cannot be reviewed.
    state.userId = CAPTAIN;
    const notHired = await request(API)
      .post(`/api/video/arena/applications/${pendingApp.body.id}/review`)
      .send({ rating: 5, note: "great fit" });
    expect(notHired.status).toBe(409);

    // Now hire ALICE.
    state.userId = CAPTAIN;
    const accepted = await request(API).post(`/api/video/arena/applications/${pendingApp.body.id}/accept`);
    expect(accepted.status).toBe(200);

    // BOB (declined, not a participant) is refused.
    state.userId = BOB;
    const outsider = await request(API)
      .post(`/api/video/arena/applications/${pendingApp.body.id}/review`)
      .send({ rating: 5, note: "I was better" });
    expect(outsider.status).toBe(403);
  });

  it("lets the Captain and the hire review once each, notifying the reviewee", async () => {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    const applicationId = await hireAlice(CAPTAIN, a.id, post);

    // Captain → hired applicant.
    state.userId = CAPTAIN;
    const captainReview = await request(API)
      .post(`/api/video/arena/applications/${applicationId}/review`)
      .send({ rating: 5, note: "Reliable, fast, and a great eye for pacing." });
    expect(captainReview.status).toBe(201);
    expect(captainReview.body.rating).toBe(5);
    expect(captainReview.body.reviewerId).toBe(CAPTAIN);
    expect(captainReview.body.reviewerName).toBe("Ada Captain");
    expect(captainReview.body.revieweeId).toBe(ALICE);
    expect(captainReview.body.applicationId).toBe(applicationId);
    expect(captainReview.body.projectId).toBe(a.id);
    expect(captainReview.body.role).toBe("VIDEO");
    expect(captainReview.body.note).toBe("Reliable, fast, and a great eye for pacing.");

    // Once per participant.
    const dup = await request(API)
      .post(`/api/video/arena/applications/${applicationId}/review`)
      .send({ rating: 4, note: "changed my mind" });
    expect(dup.status).toBe(409);

    // Hired applicant → Captain (the other direction is a separate review).
    state.userId = ALICE;
    const hireReview = await request(API)
      .post(`/api/video/arena/applications/${applicationId}/review`)
      .send({ rating: 5, note: "Loved the brief — clear direction throughout." });
    expect(hireReview.status).toBe(201);
    expect(hireReview.body.reviewerId).toBe(ALICE);
    expect(hireReview.body.reviewerName).toBe("Alice Artist");
    expect(hireReview.body.revieweeId).toBe(CAPTAIN);

    // Each side was notified with their own profile deep link.
    const notices = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable)
      .where(eq(state.tables.tandemVideoNotificationsTable.category, "video_arena_reviewed"));
    expect(notices.length).toBe(2);
    expect(notices.find((n: any) => n.recipientId === ALICE)?.deepLink).toBe(`/creators-den/profile/${ALICE}`);
    expect(notices.find((n: any) => n.recipientId === CAPTAIN)?.deepLink).toBe(`/creators-den/profile/${CAPTAIN}`);

    // Exactly two public review rows on the hire (one per participant).
    const rows = await state.db
      .select()
      .from(state.tables.tandemArenaReviewsTable)
      .where(eq(state.tables.tandemArenaReviewsTable.applicationId, applicationId));
    expect(rows.length).toBe(2);
    expect(rows.map((r: any) => r.reviewerId).sort()).toEqual([ALICE, CAPTAIN].sort());
  });
});

describe("public profile reviews — GET /video/arena/reviews", () => {
  const MESSAGE = "I've cut 40+ long-form videos for creators and can start immediately with your workflow.";

  // Captain posts a VIDEO role on a fresh project and hires ALICE for it.
  async function hireAliceOnce(): Promise<{ projectId: string; applicationId: string }> {
    const a = await seedProject(CAPTAIN);
    const post = await createPost(CAPTAIN, a.id, "VIDEO");
    state.userId = ALICE;
    const app = await request(API)
      .post(`/api/video/arena/posts/${post.id}/applications`)
      .field("message", MESSAGE);
    state.userId = CAPTAIN;
    const accepted = await request(API).post(`/api/video/arena/applications/${app.body.id}/accept`);
    expect(accepted.status).toBe(200);
    return { projectId: a.id, applicationId: app.body.id };
  }

  it("requires auth and a reviewee id", async () => {
    state.userId = null;
    expect((await request(API).get("/api/video/arena/reviews")).status).toBe(401);
    state.userId = BOB;
    expect((await request(API).get("/api/video/arena/reviews")).status).toBe(400);
    expect((await request(API).get("/api/video/arena/reviews?userId=")).status).toBe(400);
  });

  it("returns only the reviews a profile received, newest first, hydrated, and public", async () => {
    const { projectId, applicationId } = await hireAliceOnce();

    // Captain reviews ALICE; ALICE reviews the Captain.
    state.userId = CAPTAIN;
    const captainReview = await request(API)
      .post(`/api/video/arena/applications/${applicationId}/review`)
      .send({ rating: 5, note: "Reliable, fast, and a great eye for pacing." });
    expect(captainReview.status).toBe(201);
    state.userId = ALICE;
    const hireReview = await request(API)
      .post(`/api/video/arena/applications/${applicationId}/review`)
      .send({ rating: 4, note: "Clear brief and quick decisions." });
    expect(hireReview.status).toBe(201);

    // ALICE received exactly one review — the Captain's — readable by any
    // signed-in creator (BOB is not a participant of the hire).
    state.userId = BOB;
    const aliceReviews = await request(API).get(`/api/video/arena/reviews?userId=${ALICE}`);
    expect(aliceReviews.status).toBe(200);
    expect(aliceReviews.body).toHaveLength(1);
    expect(aliceReviews.body[0].reviewerId).toBe(CAPTAIN);
    expect(aliceReviews.body[0].reviewerName).toBe("Ada Captain");
    expect(aliceReviews.body[0].reviewerImageUrl).toBe(`https://img.example/${CAPTAIN}.png`);
    expect(aliceReviews.body[0].revieweeId).toBe(ALICE);
    expect(aliceReviews.body[0].applicationId).toBe(applicationId);
    expect(aliceReviews.body[0].projectId).toBe(projectId);
    expect(aliceReviews.body[0].role).toBe("VIDEO");
    expect(aliceReviews.body[0].rating).toBe(5);
    expect(aliceReviews.body[0].note).toBe("Reliable, fast, and a great eye for pacing.");
    expect(aliceReviews.body[0].projectName).toBe(`Project ${projectId}`);

    // The Captain received the hire's review, newest first (the hire's review
    // was written after the Captain's, so on CAPTAIN's list it is first).
    const captainReviews = await request(API).get(`/api/video/arena/reviews?userId=${CAPTAIN}`);
    expect(captainReviews.status).toBe(200);
    expect(captainReviews.body).toHaveLength(1);
    expect(captainReviews.body[0].reviewerId).toBe(ALICE);
    expect(captainReviews.body[0].reviewerName).toBe("Alice Artist");
    expect(captainReviews.body[0].projectName).toBe(`Project ${projectId}`);

    // A profile that received nothing is an empty list, not an error.
    const nobody = await request(API).get(`/api/video/arena/reviews?userId=${BOB}`);
    expect(nobody.status).toBe(200);
    expect(nobody.body).toEqual([]);
  });
});
