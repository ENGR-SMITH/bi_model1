import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { tandemUid } from "../lib/tandem-uid";
import { clearUserNameCache } from "../lib/user-names";

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
        const all = () =>
          Object.entries(state.clerkIdToName).map(([id, name]) => {
            const [first, ...rest] = name.split(" ");
            return { id, firstName: first || null, lastName: rest.join(" ") || null, username: null, emailAddresses: [], imageUrl: `https://img.example/${id}.png` };
          });
        if (params.userId) {
          return { data: params.userId.map((id) => ({ id, firstName: state.clerkIdToName[id]?.split(" ")[0] ?? null, lastName: state.clerkIdToName[id]?.split(" ").slice(1).join(" ") || null, username: null, emailAddresses: [], imageUrl: `https://img.example/${id}.png` })) };
        }
        const users = all();
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

import videoRouter from "./video";
import channelsRouter from "./channels";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", channelsRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
  await state.db.delete(t.tandemChannelOauthTable);
  await state.db.delete(t.tandemChannelMembersTable);
  await state.db.delete(t.tandemChannelsTable);
  await state.db.delete(t.tandemVideoNotificationsTable);
  state.userId = null;
  state.clerkIdToName = {};
  clearUserNameCache();
}

beforeEach(async () => {
  await resetDb();
  state.userId = "user-1";
  state.clerkIdToName = { "user-1": "Ada Lovelace", "user-2": "Grace Hopper", "user-3": "Alan Turing" };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function createChannel(name: string, as = "user-1") {
  state.userId = as;
  const res = await request(API).post("/api/channels").send({ name });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function createProject(channelId: string | undefined, name: string, as = "user-1") {
  state.userId = as;
  const res = await request(API).post("/api/video/projects").send(channelId ? { name, channelId } : { name });
  return res;
}

async function addMember(projectId: string, targetId: string, role: string) {
  const res = await request(API)
    .post(`/api/video/projects/${projectId}/members`)
    .send({ uid: tandemUid(targetId), role });
  expect(res.status).toBeGreaterThanOrEqual(200);
  expect(res.status).toBeLessThan(300);
}

async function editorRows(userId: string) {
  return state.db
    .select()
    .from(state.tables.tandemChannelMembersTable)
    .where(eq(state.tables.tandemChannelMembersTable.userId, userId));
}

describe("channel CMS grid", () => {
  it("requires authentication", async () => {
    state.userId = null;
    expect((await request(API).get("/api/channels")).status).toBe(401);
    expect((await request(API).post("/api/channels").send({ name: "X" })).status).toBe(401);
  });

  it("creates a channel owned by the caller and lists it with counts", async () => {
    const { id } = await createChannel("Ada Makes Games");
    const detail = await request(API).get(`/api/channels/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.myRole).toBe("OWNER");
    expect(detail.body.youtubeConnected).toBe(false);
    expect(detail.body.projectCount).toBe(0);
    expect(detail.body.editorCount).toBe(1);

    const list = await request(API).get("/api/channels");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);
    expect(list.body[0].name).toBe("Ada Makes Games");
    expect(list.body[0].myRole).toBe("OWNER");
  });

  it("does not leak channels the caller is not on and 404s unknown ids", async () => {
    const { id } = await createChannel("Private Channel");
    state.userId = "user-2";
    expect((await request(API).get(`/api/channels/${id}`)).status).toBe(403);
    expect((await request(API).get("/api/channels")).body).toEqual([]);
    state.userId = "user-1";
    expect((await request(API).get("/api/channels/does-not-exist")).status).toBe(404);
  });

  it("only the owner can rename or delete a channel", async () => {
    const { id } = await createChannel("Rename Me");
    state.userId = "user-2";
    expect((await request(API).patch(`/api/channels/${id}`).send({ name: "Hijacked" })).status).toBe(403);
    expect((await request(API).delete(`/api/channels/${id}`)).status).toBe(403);
    state.userId = "user-1";
    const rename = await request(API).patch(`/api/channels/${id}`).send({ name: "Renamed" });
    expect(rename.status).toBe(200);
    expect(rename.body.name).toBe("Renamed");
    expect((await request(API).delete(`/api/channels/${id}`)).status).toBe(204);
    expect((await request(API).get("/api/channels")).body).toEqual([]);
  });

  it("refuses to delete a channel that still has projects", async () => {
    const { id } = await createChannel("Busy Channel");
    const created = await createProject(id, "Project One");
    expect(created.status).toBe(201);
    const del = await request(API).delete(`/api/channels/${id}`);
    expect(del.status).toBe(409);
  });
});

describe("channel-scoped projects", () => {
  it("creates a project inside an owned channel and lists it channel-scoped", async () => {
    const { id } = await createChannel("Ada Makes Games");
    const created = await createProject(id, "Interview with Ada");
    expect(created.status).toBe(201);
    expect(created.body.channelId).toBe(id);

    const scoped = await request(API).get(`/api/video/projects?channelId=${id}`);
    expect(scoped.body).toHaveLength(1);
    expect(scoped.body[0].name).toBe("Interview with Ada");

    const home = await request(API).get(`/api/channels/${id}/projects`);
    expect(home.body).toHaveLength(1);
    const summary = await request(API).get(`/api/channels/${id}`);
    expect(summary.body.projectCount).toBe(1);
  });

  it("notification deep links on channeled projects are channel-scoped", async () => {
    const { id } = await createChannel("Agency");
    const project = await createProject(id, "Client A");
    await addMember(project.body.id, "user-2", "VIDEO");

    const notes = await state.db
      .select()
      .from(state.tables.tandemVideoNotificationsTable)
      .where(eq(state.tables.tandemVideoNotificationsTable.category, "video_invite"));
    expect(notes).toHaveLength(1);
    expect(notes[0].deepLink).toBe(`/creators-den/channels/${id}/projects/${project.body.id}`);
  });

  it("rejects creating a project in a channel the caller does not own", async () => {
    const { id } = await createChannel("Mine");
    state.userId = "user-2";
    const res = await request(API).post("/api/video/projects").send({ name: "Sneak", channelId: id });
    expect(res.status).toBe(403);
    // A legacy unlinked project (no channel) still works — pre-channel tooling.
    const legacy = await request(API).post("/api/video/projects").send({ name: "Legacy" });
    expect(legacy.status).toBe(201);
    expect(legacy.body.channelId).toBeNull();
  });

  it("attaches a legacy project to a channel (once), then lists it there", async () => {
    const { id } = await createChannel("Mine");
    const legacy = await createProject(undefined, "Old Project");
    expect(legacy.body.channelId).toBeNull();

    // The unlinked list contains it; the channel list does not.
    expect((await request(API).get("/api/video/projects?unlinked=1")).body).toHaveLength(1);
    expect((await request(API).get(`/api/channels/${id}/projects`)).body).toEqual([]);

    const attach = await request(API).patch(`/api/video/projects/${legacy.body.id}/channel`).send({ channelId: id });
    expect(attach.status).toBe(200);
    expect(attach.body.channelId).toBe(id);

    expect((await request(API).get(`/api/channels/${id}/projects`)).body).toHaveLength(1);
    expect((await request(API).get("/api/video/projects?unlinked=1")).body).toEqual([]);

    // Attaching twice is refused; strangers cannot attach someone else's project.
    expect((await request(API).patch(`/api/video/projects/${legacy.body.id}/channel`).send({ channelId: id })).status).toBe(400);
    state.userId = "user-2";
    expect((await request(API).patch(`/api/video/projects/${legacy.body.id}/channel`).send({ channelId: id })).status).toBe(403);
  });

  it("scopes the channel home for editors to their own memberships only", async () => {
    const { id } = await createChannel("Agency");
    await createProject(id, "Client A");
    const b = await createProject(id, "Client B");
    await addMember(b.body.id, "user-2", "VIDEO");

    state.userId = "user-2";
    const home = await request(API).get(`/api/channels/${id}/projects`);
    expect(home.status).toBe(200);
    expect(home.body.map((p: { name: string }) => p.name)).toEqual(["Client B"]);

    const scopedList = await request(API).get(`/api/video/projects?channelId=${id}`);
    expect(scopedList.body.map((p: { name: string }) => p.name)).toEqual(["Client B"]);

    // The editor's CMS mirror lists the channel with their visible project count.
    const cms = await request(API).get("/api/channels");
    expect(cms.body).toHaveLength(1);
    expect(cms.body[0].myRole).toBe("EDITOR");
    expect(cms.body[0].projectCount).toBe(1);
  });
});

describe("channel editor lifecycle (mirror cards)", () => {
  it("auto-adds an editor row when a member joins a channel project and reuses it", async () => {
    const { id } = await createChannel("Agency");
    const a = await createProject(id, "Client A");
    const b = await createProject(id, "Client B");
    await addMember(a.body.id, "user-2", "VIDEO");
    await addMember(b.body.id, "user-2", "SCRIPT");

    const rows = await editorRows("user-2");
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("EDITOR");

    // The channel's contributor roster resolves the identity + project roles.
    const people = await request(API).get(`/api/channels/${id}/people`);
    const editor = people.body.find((p: { userId: string }) => p.userId === "user-2");
    expect(people.body).toHaveLength(2);
    expect(editor.name).toBe("Grace Hopper");
    expect(editor.projectRoles).toEqual(expect.arrayContaining(["VIDEO", "SCRIPT"]));
    expect(editor.projectCount).toBe(2);
    expect(editor.imageUrl).toContain("user-2");
  });

  it("drops the mirror card when the member leaves the last project on the channel", async () => {
    const { id } = await createChannel("Agency");
    const project = await createProject(id, "Client A");
    await addMember(project.body.id, "user-2", "VIDEO");

    // The editor sees the channel on their CMS.
    state.userId = "user-2";
    expect((await request(API).get("/api/channels")).body).toHaveLength(1);

    // Captain removes them from the project → the mirror card disappears.
    state.userId = "user-1";
    const detail = await request(API).get(`/api/video/projects/${project.body.id}`);
    const memberRow = detail.body.members.find((m: { userId: string }) => m.userId === "user-2");
    const removed = await request(API).delete(`/api/video/projects/${project.body.id}/members/${memberRow.id}`);
    expect(removed.status).toBe(204);

    expect(await editorRows("user-2")).toEqual([]);
    state.userId = "user-2";
    expect((await request(API).get("/api/channels")).body).toEqual([]);
    expect((await request(API).get(`/api/channels/${id}/projects`)).status).toBe(403);
  });

  it("keeps an editor whose other memberships on the channel remain", async () => {
    const { id } = await createChannel("Agency");
    const a = await createProject(id, "Client A");
    const b = await createProject(id, "Client B");
    await addMember(a.body.id, "user-2", "VIDEO");
    await addMember(b.body.id, "user-2", "SCRIPT");

    state.userId = "user-1";
    const detailA = await request(API).get(`/api/video/projects/${a.body.id}`);
    const memberRow = detailA.body.members.find((m: { userId: string }) => m.userId === "user-2");
    await request(API).delete(`/api/video/projects/${a.body.id}/members/${memberRow.id}`);

    // Still an editor (project B membership) — the card must persist.
    expect(await editorRows("user-2")).toHaveLength(1);
    state.userId = "user-2";
    expect((await request(API).get("/api/channels")).body).toHaveLength(1);
  });

  it("syncs editors when a channel project is deleted", async () => {
    const { id } = await createChannel("Agency");
    const project = await createProject(id, "Client A");
    await addMember(project.body.id, "user-2", "VIDEO");
    expect(await editorRows("user-2")).toHaveLength(1);

    state.userId = "user-1";
    expect((await request(API).delete(`/api/video/projects/${project.body.id}`)).status).toBe(204);
    expect(await editorRows("user-2")).toEqual([]);
  });

  it("deleting an emptied channel clears its roster", async () => {
    const { id } = await createChannel("Agency");
    const a = await createProject(id, "Client A");
    await addMember(a.body.id, "user-2", "VIDEO");
    state.userId = "user-1";
    await request(API).delete(`/api/video/projects/${a.body.id}`);
    expect((await request(API).delete(`/api/channels/${id}`)).status).toBe(204);
    expect(await state.db.select().from(state.tables.tandemChannelMembersTable)).toEqual([]);
  });

  it("never duplicates an OWNER row for the channel owner when re-added", async () => {
    const { id } = await createChannel("Agency");
    const project = await createProject(id, "Client A");
    // Inviting the owner onto their own project merges roles — no EDITOR row.
    await addMember(project.body.id, "user-1", "VIDEO");
    const ownerRows = await state.db
      .select()
      .from(state.tables.tandemChannelMembersTable)
      .where(
        and(
          eq(state.tables.tandemChannelMembersTable.channelId, id),
          eq(state.tables.tandemChannelMembersTable.userId, "user-1"),
        ),
      );
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0].role).toBe("OWNER");
  });
});
