import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { runWorkerCycle } from "../video/worker";
import { backfillContentHashes } from "../video/content-address";
import { clearUserNameCache } from "../lib/user-names";
import { tandemUid } from "../lib/tandem-uid";

// Uploads land on disk; point multer at a throwaway temp dir for tests.
process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "video-test-"));

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
      getUserList: async (params: { limit?: number; offset?: number; emailAddress?: string[]; userId?: string[] }) => {
        const all = () => {
          const rows = Object.entries(state.clerkIdToName).map(([id, name]) => {
            const [first, ...rest] = name.split(" ");
            return {
              id,
              firstName: first || null,
              lastName: rest.join(" ") || null,
              username: null,
              emailAddresses: [],
            };
          });
          // Emails may map to users with no resolved name — include them too so
          // the paginated Tandem-ID invite lookup can find them.
          const known = new Set(Object.keys(state.clerkIdToName));
          for (const id of Object.values(state.clerkEmailToUser)) {
            if (id && !known.has(id)) {
              rows.push({ id, firstName: null, lastName: null, username: null, emailAddresses: [] });
            }
          }
          return rows;
        };
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
              };
            }),
          };
        }
        if (params.emailAddress) {
          const id = state.clerkEmailToUser[params.emailAddress[0] ?? ""] ?? null;
          return { data: id ? all().filter((u) => u.id === id) : [] };
        }
        // Paginated walk used by the Tandem-ID invite lookup.
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
import videoProductionRouter from "./video-production";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", videoProductionRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoNotificationsTable);
  await state.db.delete(t.tandemVideoGrantsTable);
  await state.db.delete(t.tandemVideoReferencesTable);
  await state.db.delete(t.tandemVideoSyncsTable);
  await state.db.delete(t.tandemVideoJobsTable);
  await state.db.delete(t.tandemVideoCommentsTable);
  await state.db.delete(t.tandemVideoSubmissionsTable);
  await state.db.delete(t.tandemVideoTimelineVersionsTable);
  await state.db.delete(t.tandemVideoTimelinesTable);
  await state.db.delete(t.tandemVideoTranscriptSegmentsTable);
  await state.db.delete(t.tandemVideoTranscriptsTable);
  await state.db.delete(t.tandemVideoAssetFilesTable);
  await state.db.delete(t.tandemVideoAssetsTable);
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
  state.userId = null;
  clearUserNameCache();
  state.clerkEmailToUser = {
    "editor@example.com": "user-2",
    "sound@example.com": "user-3",
    "creator2@example.com": "captain-2",
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

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authorization", () => {
  it("rejects unauthenticated writes and private reads", async () => {
    state.userId = null;
    expect((await request(API).post("/api/video/projects").send({ name: "X" })).status).toBe(401);
    expect((await request(API).get("/api/video/projects")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/whatever")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/whatever/assets")).status).toBe(401);
    expect((await request(API).post("/api/video/projects/whatever/assets")).status).toBe(401);
  });

  it("validates the project body", async () => {
    state.userId = "captain-1";
    const res = await request(API).post("/api/video/projects").send({ description: "missing name" });
    expect(res.status).toBe(400);
  });

  it("only members can read a project or its vault", async () => {
    const project = await createProject();
    state.userId = "stranger-1";
    expect((await request(API).get(`/api/video/projects/${project.id}`)).status).toBe(403);
    expect((await request(API).get(`/api/video/projects/${project.id}/assets`)).status).toBe(403);
    state.userId = "captain-1";
    expect((await request(API).get(`/api/video/projects/${project.id}`)).status).toBe(200);
  });

  it("PUBLIC projects open read-only to strangers (read OK, writes blocked)", async () => {
    const project = await createProject();

    // Captain marks the project PUBLIC.
    state.userId = "captain-1";
    const flip = await request(API)
      .patch(`/api/video/projects/${project.id}/visibility`)
      .send({ visibility: "PUBLIC" });
    expect(flip.status).toBe(200);

    // A stranger can now read the project read-only: no roles, but the member
    // roster still resolves names + avatar urls (for timeline cards).
    state.userId = "stranger-1";
    const detail = await request(API).get(`/api/video/projects/${project.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.myRoles).toEqual([]);
    expect(detail.body.visibility).toBe("PUBLIC");
    expect(detail.body.members.some((member: any) => member.userId === "captain-1")).toBe(true);
    expect(detail.body.members[0].name).toBeTruthy();
    expect(detail.body.members[0]).toHaveProperty("imageUrl");

    // The read-only data the preview + timeline pages need is readable.
    expect((await request(API).get(`/api/video/projects/${project.id}/assets`)).status).toBe(200);
    expect((await request(API).get(`/api/video/projects/${project.id}/timelines/SELECTS`)).status).toBe(200);
    expect((await request(API).get(`/api/video/projects/${project.id}/timelines/SELECTS/versions`)).status).toBe(200);
    expect((await request(API).get(`/api/video/projects/${project.id}/comments`)).status).toBe(200);
    expect((await request(API).get(`/api/video/projects/${project.id}/activity`)).status).toBe(200);

    // Writes stay blocked for the stranger even on a PUBLIC project.
    expect((await request(API).post(`/api/video/projects/${project.id}/assets`).attach("file", Buffer.from("x"), "a.mp4")).status).toBe(403);
    expect(
      (await request(API)
        .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
        .send({ snapshot: { clips: [] } }))
        .status,
    ).toBe(403);

    // Members still see their full roles.
    state.userId = "captain-1";
    expect((await request(API).get(`/api/video/projects/${project.id}`)).body.myRoles).toContain("CAPTAIN");
  });

  it("returns 404 for a missing project", async () => {
    state.userId = "captain-1";
    expect((await request(API).get("/api/video/projects/does-not-exist")).status).toBe(404);
  });
});

describe("projects", () => {
  it("creates a project and makes the creator the Captain", async () => {
    const project = await createProject();
    expect(project.ownerId).toBe("captain-1");
    expect(project.myRoles).toEqual(["CAPTAIN"]);
    expect(project.name).toBe("The Salt Road Vlog");
    expect(project.status).toBe("VAULT");
    expect(project.members).toHaveLength(1);
    expect(project.members[0].roles).toEqual(["CAPTAIN"]);
    // Member ids resolve to Clerk display names on the project detail.
    expect(project.members[0].name).toBe("Ada Captain");
    expect(project.assets).toHaveLength(0);
  });

  it("lists only the projects the user owns or belongs to", async () => {
    const owned = await createProject();
    // captain-2 creates their own project.
    const other = await createProject("captain-2", "Other Vlog");

    // captain-1 adds captain-2 as a video editor, then captain-2 sees both.
    state.userId = "captain-1";
    await request(API)
      .post(`/api/video/projects/${owned.id}/members`)
      .send({ uid: tandemUid("captain-2"), role: "VIDEO" });

    state.userId = "captain-2";
    const list = await request(API).get("/api/video/projects");
    expect(list.status).toBe(200);
    const ids = list.body.map((p: any) => p.id);
    expect(ids).toContain(owned.id);
    expect(ids).toContain(other.id);

    state.userId = "captain-1";
    const ownList = await request(API).get("/api/video/projects");
    expect(ownList.body.map((p: any) => p.id)).toEqual([owned.id]);
  });
});

describe("project deletion", () => {
  it("lets the Captain delete their project and everything inside it", async () => {
    const project = await createProject();
    // Add a member + upload an asset so there's real data to cascade.
    state.userId = "captain-1";
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });
    await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("delete me"), "clip.mp4");

    state.userId = "captain-1";
    const del = await request(API).delete(`/api/video/projects/${project.id}`);
    expect(del.status).toBe(204);

    // Project + members + assets vanished.
    const [projectRow] = await state.db
      .select()
      .from(state.tables.tandemVideoProjectsTable)
      .where(eq(state.tables.tandemVideoProjectsTable.id, project.id));
    expect(projectRow).toBeUndefined();
    const members = await state.db
      .select()
      .from(state.tables.tandemVideoMembersTable)
      .where(eq(state.tables.tandemVideoMembersTable.projectId, project.id));
    expect(members).toHaveLength(0);
    const assets = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, project.id));
    expect(assets).toHaveLength(0);
  });

  it("rejects deletion from non-Captains, unauthenticated, and missing projects", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });

    state.userId = "user-2";
    expect((await request(API).delete(`/api/video/projects/${project.id}`)).status).toBe(403);
    state.userId = null;
    expect((await request(API).delete(`/api/video/projects/${project.id}`)).status).toBe(401);
    state.userId = "captain-1";
    expect((await request(API).delete("/api/video/projects/does-not-exist")).status).toBe(404);
  });
});

describe("project visibility (public profile track history)", () => {
  it("creates projects PRIVATE by default", async () => {
    const project = await createProject();
    expect(project.visibility).toBe("PRIVATE");
  });

  it("lets the Captain flip visibility to PUBLIC and back", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const publicRes = await request(API)
      .patch(`/api/video/projects/${project.id}/visibility`)
      .send({ visibility: "PUBLIC" });
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.visibility).toBe("PUBLIC");

    const privateRes = await request(API)
      .patch(`/api/video/projects/${project.id}/visibility`)
      .send({ visibility: "PRIVATE" });
    expect(privateRes.status).toBe(200);
    expect(privateRes.body.visibility).toBe("PRIVATE");
  });

  it("rejects visibility changes from non-Captains and bad bodies", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });

    state.userId = "user-2";
    const memberRes = await request(API)
      .patch(`/api/video/projects/${project.id}/visibility`)
      .send({ visibility: "PUBLIC" });
    expect(memberRes.status).toBe(403);

    state.userId = "captain-1";
    const badBody = await request(API)
      .patch(`/api/video/projects/${project.id}/visibility`)
      .send({ visibility: "EVERYONE" });
    expect(badBody.status).toBe(400);

    state.userId = null;
    expect(
      (await request(API).patch(`/api/video/projects/${project.id}/visibility`).send({ visibility: "PUBLIC" })).status,
    ).toBe(401);
  });

  it("lists only PUBLIC projects on the profile track history (owned or participated)", async () => {
    const owned = await createProject();
    const other = await createProject("captain-2", "Other Vlog");

    // captain-1 makes their own project public, captain-2's stays private.
    state.userId = "captain-1";
    await request(API)
      .patch(`/api/video/projects/${owned.id}/visibility`)
      .send({ visibility: "PUBLIC" });

    // captain-2 joins captain-1's project — captain-2's profile should list it
    // (participated) even though captain-2 doesn't own it.
    await request(API)
      .post(`/api/video/projects/${owned.id}/members`)
      .send({ uid: tandemUid("captain-2"), role: "SCRIPT" });

    state.userId = "captain-1";
    const captain1Profile = await request(API).get("/api/video/users/captain-1/projects");
    expect(captain1Profile.status).toBe(200);
    expect(captain1Profile.body.map((p: any) => p.id)).toEqual([owned.id]);

    const captain2Profile = await request(API).get("/api/video/users/captain-2/projects");
    expect(captain2Profile.status).toBe(200);
    // captain-2 participated in the public project; their own stays hidden.
    expect(captain2Profile.body.map((p: any) => p.id)).toEqual([owned.id]);
    expect(captain2Profile.body[0].visibility).toBe("PUBLIC");

    state.userId = null;
    expect((await request(API).get("/api/video/users/captain-1/projects")).status).toBe(401);
  });
});

describe("members", () => {
  it("adds a member by Tandem ID with one of the four content roles", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe("user-2");
    expect(res.body.roles).toEqual(["VIDEO"]);
    expect(res.body.status).toBe("ACTIVE");
  });

  it("only the Captain can add members", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });
    state.userId = "user-2";
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-3"), role: "AUDIO" });
    expect(res.status).toBe(403);
  });

  it("rejects unknown Tandem IDs", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const unknown = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: "TANDEMZZZZZ", role: "VIEWER" });
    expect(unknown.status).toBe(400);
  });

  it("re-inviting an existing member adds the new role to their set", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const added = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "SCRIPT" });
    expect(added.status).toBe(201);
    expect(added.body.roles).toEqual(["SCRIPT"]);

    // Same user invited again with another role — merged, not a conflict.
    const merged = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "THUMBNAIL" });
    expect(merged.status).toBe(200);
    expect(merged.body.userId).toBe("user-2");
    expect(merged.body.roles).toEqual(["SCRIPT", "THUMBNAIL"]);
  });

  it("lets the Captain add or remove roles on an existing member", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const added = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });
    expect(added.status).toBe(201);

    // Give the member a second role.
    const updated = await request(API)
      .patch(`/api/video/projects/${project.id}/members/${added.body.id}`)
      .send({ roles: ["VIDEO", "AUDIO"] });
    expect(updated.status).toBe(200);
    expect(updated.body.roles).toEqual(["VIDEO", "AUDIO"]);

    // Take a role away.
    const trimmed = await request(API)
      .patch(`/api/video/projects/${project.id}/members/${added.body.id}`)
      .send({ roles: ["AUDIO"] });
    expect(trimmed.status).toBe(200);
    expect(trimmed.body.roles).toEqual(["AUDIO"]);

    // Non-Captain cannot change roles.
    state.userId = "user-2";
    expect(
      (await request(API)
        .patch(`/api/video/projects/${project.id}/members/${added.body.id}`)
        .send({ roles: ["VIDEO"] })).status,
    ).toBe(403);

    // The Captain's own roles cannot be changed.
    state.userId = "captain-1";
    const captainMember = (await request(API).get(`/api/video/projects/${project.id}`)).body.members.find(
      (m: any) => m.userId === "captain-1",
    );
    expect(
      (await request(API)
        .patch(`/api/video/projects/${project.id}/members/${captainMember.id}`)
        .send({ roles: ["VIDEO"] })).status,
    ).toBe(403);
  });

  it("lets the Captain remove a member from the project", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const added = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });
    expect(added.status).toBe(201);

    // The removed member loses access immediately.
    state.userId = "user-2";
    expect((await request(API).get(`/api/video/projects/${project.id}`)).status).toBe(200);

    state.userId = "captain-1";
    const removed = await request(API).delete(
      `/api/video/projects/${project.id}/members/${added.body.id}`,
    );
    expect(removed.status).toBe(204);

    state.userId = "user-2";
    expect((await request(API).get(`/api/video/projects/${project.id}`)).status).toBe(403);

    // Non-Captain and Captain-self removals are rejected.
    state.userId = "captain-1";
    const captainMember = (await request(API).get(`/api/video/projects/${project.id}`)).body.members.find(
      (m: any) => m.userId === "captain-1",
    );
    expect(
      (await request(API).delete(`/api/video/projects/${project.id}/members/${captainMember.id}`)).status,
    ).toBe(403);
  });
});

describe("vault assets", () => {
  it("uploads raw footage into the locked vault", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("fake video bytes"), "interview-cam-a.mp4");
    expect(res.status).toBe(201);
    expect(res.body.fileName).toBe("interview-cam-a.mp4");
    expect(res.body.kind).toBe("RAW_VIDEO");
    expect(res.body.status).toBe("UPLOADED");
    expect(res.body.version).toBe(0);
    expect(res.body.sizeBytes).toBe(16);
    expect(res.body.uploaderId).toBe("captain-1");
  });

  it("rejects uploads without a file or with an unknown kind", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const noFile = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO");
    expect(noFile.status).toBe(400);
    const badKind = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "LIVE_STREAM")
      .attach("file", Buffer.from("x"), "clip.mp4");
    expect(badKind.status).toBe(400);
  });

  it("lists vault assets newest first for members only", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("a"), "a.mp4");
    await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "B_ROLL")
      .attach("file", Buffer.from("bb"), "b.mp4");

    const res = await request(API).get(`/api/video/projects/${project.id}/assets`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // sqlite stores timestamps at second precision, so ties can reorder;
    // assert the set rather than the exact newest-first order.
    expect(res.body.map((a: any) => a.fileName).sort()).toEqual(["a.mp4", "b.mp4"]);

    state.userId = "stranger-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/assets`)).status).toBe(403);
  });

  it("stores the uploader on the asset row", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });
    state.userId = "user-2";
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "SCREEN_REC")
      .attach("file", Buffer.from("screen"), "screen.mov");
    expect(res.status).toBe(201);
    expect(res.body.uploaderId).toBe("user-2");
    const [row] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, res.body.id));
    expect(row.storageKey).toBeTruthy();
  });

  it("marks THUMBNAIL_DESIGN uploads processed immediately with the image as its proxy", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "THUMBNAIL_DESIGN")
      .attach("file", Buffer.from("fake png"), "cover.png");
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("THUMBNAIL_DESIGN");
    expect(res.body.status).toBe("PROCESSED");

    // No ffmpeg/whisper jobs — the image needs no proxy encode or transcript.
    const jobs = await state.db
      .select()
      .from(state.tables.tandemVideoJobsTable)
      .where(eq(state.tables.tandemVideoJobsTable.assetId, res.body.id));
    expect(jobs).toHaveLength(0);

    // A PROXY row serves the original file straight to the browser.
    const files = await state.db
      .select()
      .from(state.tables.tandemVideoAssetFilesTable)
      .where(eq(state.tables.tandemVideoAssetFilesTable.assetId, res.body.id));
    expect(files).toHaveLength(1);
    expect(files[0].kind).toBe("PROXY");
    expect(files[0].mimeType).toBe("image/png");

    // The proxy stream serves the image for the thumbnail studio.
    const proxy = await request(API).get(`/api/video/projects/${project.id}/assets/${res.body.id}/proxy`);
    expect(proxy.status).toBe(200);
    expect(proxy.headers["content-type"]).toContain("image/png");
  });

  it("blocks uploads whose vault kind the member's roles don't own", async () => {
    const project = await createProject();
    // user-2 holds AUDIO only — footage and images are owned by other roles.
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "AUDIO" });
    state.userId = "user-2";

    const image = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "THUMBNAIL_DESIGN")
      .attach("file", Buffer.from("png bytes"), "cover.png");
    expect(image.status).toBe(403);
    expect(image.body.error).toMatch(/Thumbnail members/i);

    const video = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("video bytes"), "cam.mp4");
    expect(video.status).toBe(403);
    expect(video.body.error).toMatch(/Video members/i);

    // The kind their role owns is fine.
    const audio = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_AUDIO")
      .attach("file", Buffer.from("audio bytes"), "mix.wav");
    expect(audio.status).toBe(201);
    expect(audio.body.kind).toBe("RAW_AUDIO");
  });

  it("lets a member with several roles upload each owned kind", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });
    // The Captain grants a second role (VIDEO + THUMBNAIL) on the member row.
    state.userId = "captain-1";
    const detail = (await request(API).get(`/api/video/projects/${project.id}`)).body;
    const member = detail.members.find((m: any) => m.userId === "user-2");
    const updated = await request(API)
      .patch(`/api/video/projects/${project.id}/members/${member.id}`)
      .send({ roles: ["VIDEO", "THUMBNAIL"] });
    expect(updated.status).toBe(200);

    state.userId = "user-2";
    const footage = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("footage"), "cam.mp4");
    expect(footage.status).toBe(201);
    const design = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "THUMBNAIL_DESIGN")
      .attach("file", Buffer.from("png"), "cover.png");
    expect(design.status).toBe(201);
    // Still blocked for a role they don't hold.
    const sound = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "VO_PICKUP")
      .attach("file", Buffer.from("voice"), "pickup.wav");
    expect(sound.status).toBe(403);
  });

  it("allows SCRIPT members to add raw audio/video for transcription only", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "SCRIPT" });
    state.userId = "user-2";

    const media = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_AUDIO")
      .attach("file", Buffer.from("interview audio"), "interview.wav");
    expect(media.status).toBe(201);

    const design = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "THUMBNAIL_DESIGN")
      .attach("file", Buffer.from("png"), "cover.png");
    expect(design.status).toBe(403);
  });

  it("blocks Viewers and lets the Captain/Uploader add any kind", async () => {
    const project = await createProject();
    // A member added without a content role is a Viewer.
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIEWER" });
    state.userId = "user-2";
    const viewer = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("x"), "cam.mp4");
    expect(viewer.status).toBe(403);
    expect(viewer.body.error).toMatch(/your roles here are Viewer/i);

    // The Captain and an Uploader can add any vault kind.
    state.userId = "captain-1";
    const capImage = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "THUMBNAIL_DESIGN")
      .attach("file", Buffer.from("png"), "cover.png");
    expect(capImage.status).toBe(201);

    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-3"), role: "UPLOADER" });
    state.userId = "user-3";
    const upImage = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "GRAPHIC")
      .attach("file", Buffer.from("png"), "graphic.png");
    expect(upImage.status).toBe(201);
  });
});

describe("content-addressed media (Git LFS)", () => {
  it("stores the sha256 content hash on every upload", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const bytes = Buffer.from("hash me once");
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", bytes, "clip.mp4");
    expect(res.status).toBe(201);
    expect(res.body.contentHash).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));
  });

  it("dedupes identical uploads to a single blob and reuses previews", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const bytes = Buffer.from("same footage, second pass");

    const first = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", bytes, "pass-a.mp4");
    expect(first.status).toBe(201);
    await runWorkerCycle();

    const [firstRow] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, first.body.id));
    const [firstProxy] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetFilesTable)
      .where(eq(state.tables.tandemVideoAssetFilesTable.assetId, first.body.id));

    // Re-upload the exact same bytes — this must not write a second file.
    const dirBefore = fs.readdirSync(process.env.VIDEO_UPLOAD_DIR!);
    const second = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", bytes, "pass-b.mp4");
    expect(second.status).toBe(201);
    expect(second.body.contentHash).toBe(first.body.contentHash);
    expect(second.body.status).toBe("PROCESSED");
    expect(fs.readdirSync(process.env.VIDEO_UPLOAD_DIR!)).toEqual(dirBefore);

    // The new asset is a pointer to the existing blob — no second copy.
    const [secondRow] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, second.body.id));
    expect(secondRow.storageKey).toBe(firstRow.storageKey);

    // Derived previews are reused: the same proxy + transcript, no jobs, and
    // the asset is already marked PROCESSED.
    const [secondProxy] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetFilesTable)
      .where(eq(state.tables.tandemVideoAssetFilesTable.assetId, second.body.id));
    expect(secondProxy).toBeTruthy();
    expect(secondProxy.storageKey).toBe(firstProxy.storageKey);

    const [firstTranscript] = await state.db
      .select()
      .from(state.tables.tandemVideoTranscriptsTable)
      .where(eq(state.tables.tandemVideoTranscriptsTable.assetId, first.body.id));
    const [secondTranscript] = await state.db
      .select()
      .from(state.tables.tandemVideoTranscriptsTable)
      .where(eq(state.tables.tandemVideoTranscriptsTable.assetId, second.body.id));
    expect(secondTranscript).toBeTruthy();
    const firstSegments = await state.db
      .select()
      .from(state.tables.tandemVideoTranscriptSegmentsTable)
      .where(eq(state.tables.tandemVideoTranscriptSegmentsTable.transcriptId, firstTranscript.id));
    const secondSegments = await state.db
      .select()
      .from(state.tables.tandemVideoTranscriptSegmentsTable)
      .where(eq(state.tables.tandemVideoTranscriptSegmentsTable.transcriptId, secondTranscript.id));
    expect(secondSegments).toHaveLength(firstSegments.length);

    const jobs = await state.db
      .select()
      .from(state.tables.tandemVideoJobsTable)
      .where(eq(state.tables.tandemVideoJobsTable.assetId, second.body.id));
    expect(jobs).toHaveLength(0);
  });

  it("dedupes across projects — the vault is one content-addressed store", async () => {
    const projectA = await createProject();
    const projectB = await createProject(undefined, "Second Room");
    state.userId = "captain-1";
    const bytes = Buffer.from("shared master export");

    await request(API)
      .post(`/api/video/projects/${projectA.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", bytes, "master-a.mp4");
    await request(API)
      .post(`/api/video/projects/${projectB.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", bytes, "master-b.mp4");

    const [a] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, projectA.id));
    const [b] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, projectB.id));
    expect(b.storageKey).toBe(a.storageKey);
    expect(b.contentHash).toBe(a.contentHash);
  });

  it("dedupes against backfilled legacy uploads (pre-content-addressing rows)", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const bytes = Buffer.from("old footage, pre-hash era");

    // Simulate a legacy asset: uploaded before hashing existed, file on disk
    // but no contentHash column value. Backfill it, then re-upload the same
    // bytes — the new asset must point at the legacy blob.
    const key = "legacy-session.mp4";
    fs.writeFileSync(path.join(process.env.VIDEO_UPLOAD_DIR!, key), bytes);
    await state.db.insert(state.tables.tandemVideoAssetsTable).values({
      id: "asset-legacy",
      projectId: project.id,
      uploaderId: "captain-1",
      kind: "RAW_VIDEO",
      fileName: "legacy.mp4",
      mimeType: "video/mp4",
      sizeBytes: bytes.length,
      storageKey: key,
      status: "PROCESSED",
      version: 0,
      createdAt: new Date(),
    });
    await backfillContentHashes(process.env.VIDEO_UPLOAD_DIR!);

    const res = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", bytes, "re-upload.mp4");
    expect(res.status).toBe(201);

    const [legacyRow] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, "asset-legacy"));
    const [newRow] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, res.body.id));
    expect(newRow.storageKey).toBe(legacyRow.storageKey);
    expect(legacyRow.contentHash).toBeTruthy();
  });

  it("dedupes before processing and still queues the missing preview jobs", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const bytes = Buffer.from("queued twice");

    await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", bytes, "first.mp4");

    // No worker run between uploads: nothing to reuse yet, so the second
    // upload still enqueues its own PROXY + TRANSCRIBE jobs.
    const second = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", bytes, "second.mp4");
    expect(second.status).toBe(201);
    expect(second.body.status).toBe("UPLOADED");

    const jobs = await state.db
      .select()
      .from(state.tables.tandemVideoJobsTable)
      .where(eq(state.tables.tandemVideoJobsTable.assetId, second.body.id));
    expect(jobs.map((job: any) => job.type).sort()).toEqual(["PROXY", "TRANSCRIBE"]);
  });
});

describe("submit-for-review uploads (review = true)", () => {
  async function uploadForReview(opts: {
    projectId: string;
    kind: string;
    fileName: string;
    bytes?: string;
    note?: string;
    asUser?: string;
    /** Owner override: route the Captain's own upload through review too. */
    forceReview?: boolean;
  }) {
    state.userId = opts.asUser ?? "captain-1";
    let req = request(API)
      .post(`/api/video/projects/${opts.projectId}/assets`)
      .field("kind", opts.kind)
      .field("review", "true");
    if (opts.forceReview) req = req.field("forceReview", "true");
    if (opts.note !== undefined) req = req.field("note", opts.note);
    return req.attach("file", Buffer.from(opts.bytes ?? "pending upload bytes"), opts.fileName);
  }

  it("holds the file back as PENDING_REVIEW and puts it on the Captain's queue", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });

    const res = await uploadForReview({
      projectId: project.id,
      kind: "RAW_VIDEO",
      fileName: "golden-take-a.mp4",
      note: "Best angle of the hero shot.",
      asUser: "user-2",
    });
    expect(res.status).toBe(201);
    expect(res.body.review).toBe(true);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.submissionId).toBeTruthy();

    // One staged row, still PENDING_REVIEW — invisible to the vault/project.
    const [pending] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, project.id));
    expect(pending.status).toBe("PENDING_REVIEW");
    expect(pending.storageKey).toBeTruthy();

    state.userId = "user-2";
    const detail = await request(API).get(`/api/video/projects/${project.id}`);
    expect(detail.body.assets).toHaveLength(0);

    // The Captain's review queue carries it with the file name + note.
    state.userId = "captain-1";
    const queue = await request(API).get("/api/video/review/queue");
    expect(queue.status).toBe(200);
    const row = queue.body.find((s: any) => s.id === res.body.submissionId);
    expect(row).toBeTruthy();
    expect(row.status).toBe("SUBMITTED");
    expect(row.leg).toBe("SELECTS");
    expect(row.note).toBe("golden-take-a.mp4 — Best angle of the hero shot.");
    expect(row.submittedById).toBe("user-2");
  });

  it("lets the Captain preview a held file in the review canvas before deciding", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });

    const upload = await uploadForReview({
      projectId: project.id,
      kind: "RAW_VIDEO",
      fileName: "held-preview.mp4",
      note: "Check this one.",
      asUser: "user-2",
    });
    expect(upload.status).toBe(201);
    const [pendingRow] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, project.id));
    expect(pendingRow.status).toBe("PENDING_REVIEW");
    const stagedPath = path.join(process.env.VIDEO_UPLOAD_DIR!, pendingRow.storageKey);
    expect(fs.existsSync(stagedPath)).toBe(true);

    // The staged file's detail is readable by project members — the review
    // canvas needs kind/mime to pick the right player for the held file.
    state.userId = "captain-1";
    const detail = await request(API).get(`/api/video/projects/${project.id}/assets/${pendingRow.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe("PENDING_REVIEW");
    expect(detail.body.kind).toBe("RAW_VIDEO");
    expect(detail.body.fileName).toBe("held-preview.mp4");

    // And the staged original streams to the Captain so the Big canvas plays
    // the actual submission before the decision.
    const proxy = await request(API).get(`/api/video/projects/${project.id}/assets/${pendingRow.id}/proxy`);
    expect(proxy.status).toBe(200);
    expect(Number(proxy.headers["content-length"])).toBeGreaterThan(0);
    expect(proxy.headers["accept-ranges"]).toBe("bytes");
    expect(proxy.headers["content-type"]).toContain("mp4");

    // A non-member must never see a pending submission's bytes — PUBLIC
    // read-only preview only covers approved vault files.
    await request(API).patch(`/api/video/projects/${project.id}/visibility`).send({ visibility: "PUBLIC" });
    state.userId = "stranger-1";
    const blocked = await request(API).get(`/api/video/projects/${project.id}/assets/${pendingRow.id}/proxy`);
    expect(blocked.status).toBe(403);
  });

  it("approving the submission lands the file in the vault and starts processing", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "VIDEO" });

    const upload = await uploadForReview({
      projectId: project.id,
      kind: "RAW_VIDEO",
      fileName: "golden-take-a.mp4",
      note: "Best angle of the hero shot.",
      asUser: "user-2",
    });
    expect(upload.status).toBe(201);
    const [pendingRow] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, project.id));
    const stagedPath = path.join(process.env.VIDEO_UPLOAD_DIR!, pendingRow.storageKey);
    expect(fs.existsSync(stagedPath)).toBe(true);

    // Rejecting is only open to the owning Captain.
    state.userId = "user-2";
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/submissions/${upload.body.submissionId}/approve`)
      .send({});
    expect(forbidden.status).toBe(403);

    // The Captain approves — the staged placeholder becomes a live vault
    // asset (jobs enqueued), and the submission points at the real row.
    state.userId = "captain-1";
    const approve = await request(API)
      .post(`/api/video/projects/${project.id}/submissions/${upload.body.submissionId}/approve`)
      .send({});
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("APPROVED");

    const assets = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, project.id));
    expect(assets).toHaveLength(1);
    expect(assets[0].id).not.toBe(upload.body.id);
    expect(assets[0].status).not.toBe("PENDING_REVIEW");
    expect(assets[0].fileName).toBe("golden-take-a.mp4");
    expect(assets[0].contentHash).toBeTruthy();

    // RAW_VIDEO enqueues proxy + transcription and keeps the file on disk.
    const jobs = await state.db
      .select()
      .from(state.tables.tandemVideoJobsTable)
      .where(eq(state.tables.tandemVideoJobsTable.assetId, assets[0].id));
    expect(jobs.map((job: any) => job.type).sort()).toEqual(["PROXY", "TRANSCRIBE"]);

    const [submissionRow] = await state.db
      .select()
      .from(state.tables.tandemVideoSubmissionsTable)
      .where(eq(state.tables.tandemVideoSubmissionsTable.id, upload.body.submissionId));
    expect(submissionRow.status).toBe("APPROVED");
    expect(submissionRow.timelineVersionId).toBe(`ASSET:${assets[0].id}`);

    // The approved file now shows in the project vault for members.
    state.userId = "user-2";
    const detail = await request(API).get(`/api/video/projects/${project.id}`);
    expect(detail.body.assets).toHaveLength(1);
    expect(detail.body.assets[0].id).toBe(assets[0].id);

    // No timeline leg was touched — nothing was merged into a stage.
    const timelines = await state.db
      .select()
      .from(state.tables.tandemVideoTimelinesTable)
      .where(eq(state.tables.tandemVideoTimelinesTable.projectId, project.id));
    expect(timelines).toHaveLength(0);
  });

  it("lets the Captain's own uploads skip the queue and land straight in the vault", async () => {
    const project = await createProject(); // captain-1 owns it

    const res = await uploadForReview({
      projectId: project.id,
      kind: "RAW_VIDEO",
      fileName: "captain-footage.mp4",
      note: "A couple of hero shots.",
      asUser: "captain-1",
    });
    expect(res.status).toBe(201);
    // No review hand-off: the file went through the normal upload pipeline.
    expect(res.body.review).toBeFalsy();
    expect(res.body.submissionId).toBeUndefined();
    expect(res.body.status).not.toBe("PENDING_REVIEW");
    expect(res.body.contentHash).toBeTruthy();

    // No submission was created, and the vault shows the file immediately.
    const subs = await state.db
      .select()
      .from(state.tables.tandemVideoSubmissionsTable)
      .where(eq(state.tables.tandemVideoSubmissionsTable.projectId, project.id));
    expect(subs).toHaveLength(0);
    const queue = await request(API).get("/api/video/review/queue");
    expect(queue.body).toHaveLength(0);

    state.userId = "captain-1";
    const detail = await request(API).get(`/api/video/projects/${project.id}`);
    expect(detail.body.assets).toHaveLength(1);
    expect(detail.body.assets[0].fileName).toBe("captain-footage.mp4");
  });

  it("routes the Captain's upload through review when forceReview is set", async () => {
    const project = await createProject(); // captain-1 owns it

    const res = await uploadForReview({
      projectId: project.id,
      kind: "RAW_VIDEO",
      fileName: "captain-own-hand-in.mp4",
      note: "Testing the desk with my own file.",
      asUser: "captain-1",
      forceReview: true,
    });
    expect(res.status).toBe(201);
    // The explicit override creates a real review hand-off for the owner.
    expect(res.body.review).toBe(true);
    expect(res.body.status).toBe("PENDING_REVIEW");
    expect(res.body.submissionId).toBeTruthy();

    // The file is held back from the vault until the Captain approves.
    state.userId = "captain-1";
    const detail = await request(API).get(`/api/video/projects/${project.id}`);
    expect(detail.body.assets).toHaveLength(0);

    // And it is on the review queue for the Captain to decide.
    const queue = await request(API).get("/api/video/review/queue");
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0].id).toBe(res.body.submissionId);
    expect(queue.body[0].note).toContain("captain-own-hand-in.mp4");

    // Approving it lands the file in the vault like any other submission.
    const approve = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${res.body.submissionId}/approve`,
    );
    expect(approve.status).toBe(200);
    state.userId = "captain-1";
    const after = await request(API).get(`/api/video/projects/${project.id}`);
    expect(after.body.assets).toHaveLength(1);
    expect(after.body.assets[0].fileName).toBe("captain-own-hand-in.mp4");
  });

  it("rejecting the submission deletes the staged file and frees the vault", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ uid: tandemUid("user-2"), role: "AUDIO" });

    const upload = await uploadForReview({
      projectId: project.id,
      kind: "RAW_AUDIO",
      fileName: "boom-mic.wav",
      note: "Room tone from the shoot.",
      asUser: "user-2",
    });
    expect(upload.status).toBe(201);

    const [pending] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, project.id));
    const stagedPath = path.join(process.env.VIDEO_UPLOAD_DIR!, pending.storageKey);
    expect(fs.existsSync(stagedPath)).toBe(true);

    state.userId = "captain-1";
    const reject = await request(API)
      .post(`/api/video/projects/${project.id}/submissions/${upload.body.submissionId}/reject`)
      .send({ note: "Too hissy — re-record with the lav closer." });
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe("REJECTED");

    // The staged row + its bytes are gone; the submission keeps the note.
    const assets = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.projectId, project.id));
    expect(assets).toHaveLength(0);
    expect(fs.existsSync(stagedPath)).toBe(false);

    const [submissionRow] = await state.db
      .select()
      .from(state.tables.tandemVideoSubmissionsTable)
      .where(eq(state.tables.tandemVideoSubmissionsTable.id, upload.body.submissionId));
    expect(submissionRow.status).toBe("REJECTED");
    expect(submissionRow.decisionNote).toBe("Too hissy — re-record with the lav closer.");
  });
});
