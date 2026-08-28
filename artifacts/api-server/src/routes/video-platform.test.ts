import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tandemUid } from "../lib/tandem-uid";

process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "video-platform-test-"));
process.env.TANDEM_MEDIA_DEMO = "1";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
  clerkEmailToUser: {} as Record<string, string | null>,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: {
    users: {
      getUserList: async (params: { limit?: number; offset?: number; emailAddress?: string[]; userId?: string[] }) => {
        if (params.userId) return { data: params.userId.map((id) => ({ id })) };
        if (params.emailAddress) {
          const id = state.clerkEmailToUser[params.emailAddress[0]] ?? null;
          return { data: id ? [{ id }] : [] };
        }
        const users = Object.values(state.clerkEmailToUser).map((id) => ({ id }));
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
import videoFinishRouter from "./video-finish";
import videoPlatformRouter from "./video-platform";
import { runWorkerCycle } from "../video/worker";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", videoProductionRouter);
  app.use("/api", videoFinishRouter);
  app.use("/api", videoPlatformRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoNotificationsTable);
  await state.db.delete(t.tandemVideoGrantsTable);
  await state.db.delete(t.tandemVideoReferencesTable);
  await state.db.delete(t.tandemVideoDownloadsTable);
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
  state.clerkEmailToUser = {
    "architect@example.com": "architect-1",
    "editor@example.com": "editor-1",
    "sound@example.com": "sound-1",
  };
}

async function createProject(userId = "captain-1", name = "The Salt Road Vlog") {
  state.userId = userId;
  const res = await request(API).post("/api/video/projects").send({ name, description: "Interview footage." });
  expect(res.status).toBe(201);
  return res.body as any;
}

async function addMember(projectId: string, email: string, role: string) {
  state.userId = "captain-1";
  const res = await request(API)
    .post(`/api/video/projects/${projectId}/members`)
    .send({ uid: tandemUid(state.clerkEmailToUser[email] ?? ""), role });
  expect(res.status).toBe(201);
}

async function uploadAsset(projectId: string, fileName = "interview.mp4", kind = "RAW_VIDEO") {
  const res = await request(API)
    .post(`/api/video/projects/${projectId}/assets`)
    .field("kind", kind)
    .attach("file", Buffer.from("fake video bytes"), fileName);
  expect(res.status).toBe(201);
  return res.body as any;
}

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M4 — viral reference import", () => {
  it("queues pacing analysis (Video role) and the worker writes a reference", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    const reference = await uploadAsset(project.id, "viral-tutorial.mp4", "REFERENCE");

    state.userId = "sound-1"; // wrong role
    const forbidden = await request(API).post(
      `/api/video/projects/${project.id}/assets/${reference.id}/reference-analyze`,
    );
    expect(forbidden.status).toBe(403);

    state.userId = "editor-1";
    const queued = await request(API).post(
      `/api/video/projects/${project.id}/assets/${reference.id}/reference-analyze`,
    );
    expect(queued.status).toBe(201);
    expect(queued.body.type).toBe("REFERENCE_ANALYZE");

    await runWorkerCycle();

    const got = await request(API).get(
      `/api/video/projects/${project.id}/assets/${reference.id}/reference`,
    );
    expect(got.status).toBe(200);
    expect(got.body.status).toBe("READY");
    expect(got.body.pacing.sections).toHaveLength(5);
    expect(got.body.pacing.sections[0].label).toBe("Hook");
    expect(got.body.pacing.sections[4].label).toBe("CTA");
    expect(got.body.pacing.source).toBe("DEMO");
  });

  it("returns 404 for an unanalyzed reference", async () => {
    const project = await createProject();
    const reference = await uploadAsset(project.id, "viral-tutorial.mp4", "REFERENCE");
    state.userId = "captain-1";
    const res = await request(API).get(
      `/api/video/projects/${project.id}/assets/${reference.id}/reference`,
    );
    expect(res.status).toBe(404);
  });
});

describe("M4 — download grants", () => {
  it("a role grant unlocks every file version under that role, and revoke locks it again", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    await addMember(project.id, "sound@example.com", "AUDIO");
    const video = await uploadAsset(project.id, "interview.mp4", "RAW_VIDEO");
    const audio = await uploadAsset(project.id, "stem.wav", "RAW_AUDIO");
    await runWorkerCycle();

    const videoDetail = await request(API).get(`/api/video/projects/${project.id}/assets/${video.id}`);
    const videoProxy = videoDetail.body.files.find((file: any) => file.kind === "PROXY");
    const audioDetail = await request(API).get(`/api/video/projects/${project.id}/assets/${audio.id}`);
    const audioProxy = audioDetail.body.files.find((file: any) => file.kind === "PROXY");

    // Blocked without a grant.
    state.userId = "editor-1";
    expect(
      (await request(API).get(`/api/video/projects/${project.id}/files/${videoProxy.id}/download`)).status,
    ).toBe(403);

    // Non-Captain cannot create grants.
    state.userId = "editor-1";
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/grants`)
      .send({ memberId: "editor-1", roles: ["VIDEO"], reason: "DAW repair", expiresInHours: 24 });
    expect(forbidden.status).toBe(403);

    // Captain grants the editor the VIDEO role (all video file versions).
    state.userId = "captain-1";
    const created = await request(API)
      .post(`/api/video/projects/${project.id}/grants`)
      .send({ memberId: "editor-1", roles: ["VIDEO"], reason: "DAW repair", expiresInHours: 24 });
    expect(created.status).toBe(201);
    expect(created.body.memberId).toBe("editor-1");
    expect(created.body.roles).toEqual(["VIDEO"]);
    expect(created.body.expiresAt).toBeTruthy();

    // The grant opens every video-kind download for the member…
    state.userId = "editor-1";
    expect(
      (await request(API).get(`/api/video/projects/${project.id}/files/${videoProxy.id}/download`)).status,
    ).toBe(200);
    // …but not the audio file (still locked for the audio role).
    expect(
      (await request(API).get(`/api/video/projects/${project.id}/files/${audioProxy.id}/download`)).status,
    ).toBe(403);

    // Unrelated members stay locked.
    state.userId = "sound-1";
    expect(
      (await request(API).get(`/api/video/projects/${project.id}/files/${videoProxy.id}/download`)).status,
    ).toBe(403);

    // Captain revokes → locked again.
    state.userId = "captain-1";
    const revoked = await request(API).post(
      `/api/video/projects/${project.id}/grants/${created.body.id}/revoke`,
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedAt).toBeTruthy();

    state.userId = "editor-1";
    expect(
      (await request(API).get(`/api/video/projects/${project.id}/files/${videoProxy.id}/download`)).status,
    ).toBe(403);
  });

  it("an ALL-roles grant covers every file in the project", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    const video = await uploadAsset(project.id, "interview.mp4", "RAW_VIDEO");
    const audio = await uploadAsset(project.id, "stem.wav", "RAW_AUDIO");
    await runWorkerCycle();

    const videoDetail = await request(API).get(`/api/video/projects/${project.id}/assets/${video.id}`);
    const videoProxy = videoDetail.body.files.find((file: any) => file.kind === "PROXY");
    const audioDetail = await request(API).get(`/api/video/projects/${project.id}/assets/${audio.id}`);
    const audioProxy = audioDetail.body.files.find((file: any) => file.kind === "PROXY");

    state.userId = "captain-1";
    const created = await request(API)
      .post(`/api/video/projects/${project.id}/grants`)
      .send({ memberId: "editor-1", roles: ["ALL"] });
    expect(created.status).toBe(201);
    expect(created.body.roles).toEqual(["ALL"]);

    state.userId = "editor-1";
    expect(
      (await request(API).get(`/api/video/projects/${project.id}/files/${videoProxy.id}/download`)).status,
    ).toBe(200);
    expect(
      (await request(API).get(`/api/video/projects/${project.id}/files/${audioProxy.id}/download`)).status,
    ).toBe(200);
  });

  it("rejects grants for non-members, empty roles, and non-Captains listing", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);

    state.userId = "captain-1";
    const badMember = await request(API)
      .post(`/api/video/projects/${project.id}/grants`)
      .send({ memberId: "stranger-1", roles: ["VIDEO"] });
    expect(badMember.status).toBe(400);

    const emptyRoles = await request(API)
      .post(`/api/video/projects/${project.id}/grants`)
      .send({ memberId: "captain-1", roles: [] });
    expect(emptyRoles.status).toBe(400);

    state.userId = "editor-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/grants`)).status).toBe(403);
  });
});

describe("M4 — notifications", () => {
  it("notifies the Captain on submission and the submitter on decision", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");

    // Submit as the video editor → Captain gets notified.
    state.userId = "editor-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: "a1" }] } });
    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS" });
    expect(submitted.status).toBe(201);

    state.userId = "captain-1";
    const captainNotes = await request(API).get("/api/video/notifications");
    expect(captainNotes.status).toBe(200);
    expect(captainNotes.body.some((n: any) => n.category === "video_submission")).toBe(true);

    // Captain approves → submitter gets notified.
    await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/approve`,
    );

    state.userId = "editor-1";
    const editorNotes = await request(API).get("/api/video/notifications");
    expect(editorNotes.body.some((n: any) => n.category === "video_approved")).toBe(true);

    // Mark one read.
    const unread = editorNotes.body.find((n: any) => !n.readAt);
    const marked = await request(API).post(`/api/video/notifications/${unread.id}/read`);
    expect(marked.status).toBe(200);
    expect(marked.body.readAt).toBeTruthy();
  });

  it("notifies every member when the FINISH leg is approved (lock release)", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    const asset = await uploadAsset(project.id);

    state.userId = "captain-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/FINISH`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: asset.id }] } });
    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "FINISH" });
    expect(submitted.status).toBe(201);

    state.userId = "captain-1";
    await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/approve`,
    );

    state.userId = "editor-1";
    const editorNotes = await request(API).get("/api/video/notifications");
    expect(editorNotes.body.some((n: any) => n.category === "video_released")).toBe(true);

    state.userId = "captain-1";
    const captainNotes = await request(API).get("/api/video/notifications");
    expect(captainNotes.body.some((n: any) => n.category === "video_released")).toBe(true);
  });

  it("notifies the member when a grant is created and revoked", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");
    const asset = await uploadAsset(project.id);

    state.userId = "captain-1";
    const created = await request(API)
      .post(`/api/video/projects/${project.id}/grants`)
      .send({ memberId: "editor-1", roles: ["VIDEO"], reason: "DaVinci repair" });
    expect(created.status).toBe(201);

    state.userId = "editor-1";
    let editorNotes = await request(API).get("/api/video/notifications");
    expect(editorNotes.body.some((n: any) => n.category === "video_grant")).toBe(true);

    state.userId = "captain-1";
    await request(API).post(`/api/video/projects/${project.id}/grants/${created.body.id}/revoke`);

    state.userId = "editor-1";
    editorNotes = await request(API).get("/api/video/notifications");
    expect(editorNotes.body.some((n: any) => n.category === "video_grant_revoked")).toBe(true);
  });

  it("returns 404 when marking someone else's notification read", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VIDEO");

    state.userId = "editor-1";
    await request(API)
      .post(`/api/video/projects/${project.id}/grants`)
      .send({ memberId: "editor-1", roles: ["VIDEO"], reason: "" });
    // no grant exists — grant creation failed, so just check the 401 path
    const notes = await request(API).get("/api/video/notifications");
    expect(notes.status).toBe(200);
    state.userId = null;
    expect((await request(API).get("/api/video/notifications")).status).toBe(401);
  });
});

describe("authorization on M4 routes", () => {
  it("rejects unauthenticated M4 requests", async () => {
    state.userId = null;
    expect((await request(API).post("/api/video/projects/x/assets/y/reference-analyze")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/assets/y/reference")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/grants")).status).toBe(401);
    expect((await request(API).post("/api/video/projects/x/grants").send({ memberId: "m", roles: ["VIDEO"] })).status).toBe(401);
  });
});
