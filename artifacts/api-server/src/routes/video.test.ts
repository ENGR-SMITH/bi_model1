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

  it("returns 404 for a missing project", async () => {
    state.userId = "captain-1";
    expect((await request(API).get("/api/video/projects/does-not-exist")).status).toBe(404);
  });
});

describe("projects", () => {
  it("creates a project and makes the creator the Captain", async () => {
    const project = await createProject();
    expect(project.ownerId).toBe("captain-1");
    expect(project.myRole).toBe("CAPTAIN");
    expect(project.name).toBe("The Salt Road Vlog");
    expect(project.status).toBe("VAULT");
    expect(project.members).toHaveLength(1);
    expect(project.members[0].role).toBe("CAPTAIN");
    // Member ids resolve to Clerk display names on the project detail.
    expect(project.members[0].name).toBe("Ada Captain");
    expect(project.assets).toHaveLength(0);
  });

  it("lists only the projects the user owns or belongs to", async () => {
    const owned = await createProject();
    // captain-2 creates their own project.
    const other = await createProject("captain-2", "Other Vlog");

    // captain-1 adds captain-2 as architect, then captain-2 sees both.
    state.userId = "captain-1";
    await request(API)
      .post(`/api/video/projects/${owned.id}/members`)
      .send({ email: "creator2@example.com", role: "ARCHITECT" });

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
      .send({ email: "editor@example.com", role: "VISUAL_EDITOR" });

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
      .send({ email: "creator2@example.com", role: "ARCHITECT" });

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
  it("adds a member by email with a leg role", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ email: "editor@example.com", role: "VISUAL_EDITOR" });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe("user-2");
    expect(res.body.role).toBe("VISUAL_EDITOR");
    expect(res.body.status).toBe("ACTIVE");
  });

  it("only the Captain can add members", async () => {
    const project = await createProject();
    await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ email: "editor@example.com", role: "VISUAL_EDITOR" });
    state.userId = "user-2";
    const res = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ email: "sound@example.com", role: "SOUND_DESIGNER" });
    expect(res.status).toBe(403);
  });

  it("rejects unknown emails and duplicate members", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const unknown = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ email: "nobody@example.com", role: "VIEWER" });
    expect(unknown.status).toBe(400);

    const added = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ email: "editor@example.com", role: "ARCHITECT" });
    expect(added.status).toBe(201);
    const duplicate = await request(API)
      .post(`/api/video/projects/${project.id}/members`)
      .send({ email: "editor@example.com", role: "ARCHITECT" });
    expect(duplicate.status).toBe(409);
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
      .send({ email: "editor@example.com", role: "VISUAL_EDITOR" });
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
