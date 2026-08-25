import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { clearUserNameCache } from "../lib/user-names";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  clerkEmailToUser: {} as Record<string, string | null>,
  clerkIdToName: {} as Record<string, string>,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUserList: async (params: { emailAddress?: string[]; userId?: string[] }) => {
        if (params.userId) {
          return {
            data: params.userId.map((id) => {
              const [first, ...rest] = (state.clerkIdToName[id] ?? "").split(" ");
              return {
                id,
                firstName: first || null,
                lastName: rest.join(" ") || null,
                username: null,
                emailAddresses: [],
                imageUrl: null,
              };
            }),
          };
        }
        const email = params.emailAddress?.[0] ?? "";
        const id = state.clerkEmailToUser[email] ?? null;
        return { data: id ? [{ id }] : [] };
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

import videoRouter from "./video";
import videoSocialRouter from "./video-social";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", videoSocialRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoFollowsTable);
  await state.db.delete(t.collaborationActivityEventsTable);
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
  state.userId = null;
  clearUserNameCache();
  state.clerkEmailToUser = {
    "editor@example.com": "user-2",
    "sound@example.com": "user-3",
  };
  state.clerkIdToName = {
    "captain-1": "Ada Captain",
    "user-2": "Sam Editor",
    "user-3": "Zoe Sound",
  };
}

async function createProject(userId = "captain-1", name = "The Salt Road Vlog") {
  state.userId = userId;
  const res = await request(API).post("/api/video/projects").send({ name, description: "90 min of interview footage." });
  expect(res.status).toBe(201);
  return res.body as any;
}

async function setVisibility(projectId: string, visibility: "PUBLIC" | "PRIVATE") {
  const res = await request(API)
    .patch(`/api/video/projects/${projectId}/visibility`)
    .send({ visibility });
  expect(res.status).toBe(200);
  return res.body as any;
}

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("explore — creators", () => {
  it("lists users with public track history (owned or participated), most active first", async () => {
    const owned = await createProject();
    await setVisibility(owned.id, "PUBLIC");

    // captain-2 owns a private project only — still listed because they
    // participate in captain-1's public one.
    await createProject("captain-2", "Other Vlog");
    state.userId = "captain-1";
    await request(API)
      .post(`/api/video/projects/${owned.id}/members`)
      .send({ email: "editor@example.com", role: "ARCHITECT" });

    state.userId = "captain-1";
    const res = await request(API).get("/api/video/explore/creators");
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((c: any) => [c.userId, c]));
    expect(byId["captain-1"].displayName).toBe("Ada Captain");
    expect(byId["captain-1"].publicProjectCount).toBe(1);
    expect(byId["captain-1"].followerCount).toBe(0);
    expect(byId["user-2"].publicProjectCount).toBe(1);
    expect(byId["captain-2"]).toBeUndefined(); // no public track history at all

    state.userId = null;
    expect((await request(API).get("/api/video/explore/creators")).status).toBe(401);
  });
});

describe("explore — projects", () => {
  it("lists only PUBLIC projects with resolved owner identity", async () => {
    const owned = await createProject();
    await setVisibility(owned.id, "PUBLIC");
    await createProject("captain-2", "Private Vlog");

    const res = await request(API).get("/api/video/explore/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("The Salt Road Vlog");
    expect(res.body[0].ownerName).toBe("Ada Captain");
    expect(res.body[0].visibility).toBe("PUBLIC");
  });
});

describe("follow model", () => {
  it("follows, reports social state, and unfollows", async () => {
    state.userId = "user-2";
    const follow = await request(API).post("/api/video/users/captain-1/follow");
    expect(follow.status).toBe(200);
    expect(follow.body.isFollowing).toBe(true);
    expect(follow.body.followerCount).toBe(1);

    const social = await request(API).get("/api/video/users/captain-1/social");
    expect(social.status).toBe(200);
    expect(social.body).toMatchObject({ userId: "captain-1", followerCount: 1, followingCount: 0, isFollowing: true });

    // captain-1's own perspective: isFollowing is null (no self-follow).
    state.userId = "captain-1";
    const own = await request(API).get("/api/video/users/captain-1/social");
    expect(own.body.isFollowing).toBeNull();

    // Following is idempotent.
    state.userId = "user-2";
    const again = await request(API).post("/api/video/users/captain-1/follow");
    expect(again.status).toBe(200);
    expect(again.body.followerCount).toBe(1);

    const unfollow = await request(API).delete("/api/video/users/captain-1/follow");
    expect(unfollow.status).toBe(200);
    expect(unfollow.body).toMatchObject({ isFollowing: false, followerCount: 0 });
  });

  it("rejects self-follows and unauthenticated writes", async () => {
    state.userId = "captain-1";
    expect((await request(API).post("/api/video/users/captain-1/follow")).status).toBe(400);
    expect((await request(API).delete("/api/video/users/captain-1/follow")).status).toBe(400);
    state.userId = null;
    expect((await request(API).post("/api/video/users/captain-1/follow")).status).toBe(401);
  });

  it("lists followers and following with names", async () => {
    state.userId = "user-2";
    await request(API).post("/api/video/users/captain-1/follow");
    state.userId = "user-3";
    await request(API).post("/api/video/users/captain-1/follow");
    await request(API).post("/api/video/users/user-2/follow");

    state.userId = "user-2";
    const followers = await request(API).get("/api/video/users/captain-1/followers");
    expect(followers.status).toBe(200);
    const names = followers.body.map((e: any) => e.displayName).sort();
    expect(names).toEqual(["Sam Editor", "Zoe Sound"]);

    const following = await request(API).get("/api/video/users/user-2/following");
    expect(following.status).toBe(200);
    expect(following.body.map((e: any) => e.userId)).toEqual(["captain-1"]);
    expect(following.body[0].isFollowing).toBe(true);
  });
});

describe("contributions graph", () => {
  it("aggregates public-project activity into a zero-filled recent grid", async () => {
    const project = await createProject();
    await setVisibility(project.id, "PUBLIC");
    const privateProject = await createProject("captain-2", "Private Vlog");

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await state.db.insert(state.tables.collaborationActivityEventsTable).values({
      id: randomUUID(),
      projectId: project.id,
      actorId: "captain-1",
      eventType: "version_saved",
      summary: "Saved CUT v1",
      createdAt: yesterday,
    });
    await state.db.insert(state.tables.collaborationActivityEventsTable).values({
      id: randomUUID(),
      projectId: project.id,
      actorId: "captain-1",
      eventType: "submission_approved",
      summary: "Approved CUT v1",
      createdAt: yesterday,
    });
    // Private-project activity must NOT count.
    await state.db.insert(state.tables.collaborationActivityEventsTable).values({
      id: randomUUID(),
      projectId: privateProject.id,
      actorId: "captain-1",
      eventType: "asset_uploaded",
      summary: "Secret upload",
      createdAt: yesterday,
    });

    const yesterdayKey = yesterday.toISOString().slice(0, 10);
    const res = await request(API).get("/api/video/users/captain-1/contributions");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.days).toHaveLength(26 * 7);
    const cell = res.body.days.find((d: any) => d.date === yesterdayKey);
    expect(cell?.count).toBe(2);
    expect(res.body.days.every((d: any) => d.count >= 0)).toBe(true);
  });
});
