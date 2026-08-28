import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tandemUid } from "../lib/tandem-uid";

process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "video-finish-test-"));
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
    "sound@example.com": "sound-1",
    "color@example.com": "color-1",
    "editor@example.com": "editor-1",
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

async function uploadAsset(projectId: string, fileName = "interview.mp4") {
  const res = await request(API)
    .post(`/api/video/projects/${projectId}/assets`)
    .field("kind", "RAW_VIDEO")
    .attach("file", Buffer.from("fake video bytes"), fileName);
  expect(res.status).toBe(201);
  return res.body as any;
}

async function submitLeg(projectId: string, leg: string, asUserId: string, clipsAssetId: string) {
  state.userId = asUserId;
  const saved = await request(API)
    .put(`/api/video/projects/${projectId}/timelines/${leg}`)
    .send({ snapshot: { clips: [{ id: "c1", assetId: clipsAssetId, inMs: 0, outMs: 8000 }] } });
  expect(saved.status).toBe(200);
  const submitted = await request(API)
    .post(`/api/video/projects/${projectId}/submissions`)
    .send({ leg });
  expect(submitted.status).toBe(201);
  return submitted.body as any;
}

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("M3 — audio passes (Sound Designer)", () => {
  it("queues an audio pass for the SOUND role and the worker runs it", async () => {
    const project = await createProject();
    await addMember(project.id, "sound@example.com", "AUDIO");
    const asset = await uploadAsset(project.id);

    state.userId = "editor-1"; // wrong leg role
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/audio`)
      .send({ action: "NOISE_REDUCTION", assetId: asset.id });
    expect(forbidden.status).toBe(403);

    state.userId = "sound-1";
    const queued = await request(API)
      .post(`/api/video/projects/${project.id}/audio`)
      .send({ action: "NOISE_REDUCTION", assetId: asset.id });
    expect(queued.status).toBe(201);
    expect(queued.body.type).toBe("AUDIO");
    expect(queued.body.params.action).toBe("NOISE_REDUCTION");

    await runWorkerCycle();
    const jobs = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    const audio = jobs.body.find((job: any) => job.type === "AUDIO");
    expect(audio.status).toBe("SUCCEEDED");
    expect(audio.result.demo).toBe(true);
    expect(audio.result.action).toBe("NOISE_REDUCTION");
  });
});

describe("M3 — exports + thumbnail (Motion & Color)", () => {
  it("queues one export job per format — Captain only", async () => {
    const project = await createProject();
    await addMember(project.id, "sound@example.com", "AUDIO");
    const asset = await uploadAsset(project.id);

    state.userId = "sound-1"; // not the Captain
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/exports`)
      .send({ formats: ["16:9"] });
    expect(forbidden.status).toBe(403);

    state.userId = "captain-1";
    const queued = await request(API)
      .post(`/api/video/projects/${project.id}/exports`)
      .send({ formats: ["16:9", "9:16", "1:1"] });
    expect(queued.status).toBe(201);
    expect(queued.body.type).toBe("EXPORT");

    await runWorkerCycle();
    const jobs = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    const exports = jobs.body.filter((job: any) => job.type === "EXPORT");
    expect(exports).toHaveLength(3);
    const formats = exports.map((job: any) => job.params.format).sort();
    expect(formats).toEqual(["16:9", "1:1", "9:16"]);
    expect(exports.every((job: any) => job.status === "SUCCEEDED")).toBe(true);
  });

  it("queues a thumbnail extraction pinned to a frame — Captain only", async () => {
    const project = await createProject();
    await addMember(project.id, "color@example.com", "THUMBNAIL");
    const asset = await uploadAsset(project.id);

    state.userId = "color-1";
    expect(
      (await request(API)
        .post(`/api/video/projects/${project.id}/thumbnail`)
        .send({ assetId: asset.id, timeMs: 134000 })).status,
    ).toBe(403);

    state.userId = "captain-1";
    const queued = await request(API)
      .post(`/api/video/projects/${project.id}/thumbnail`)
      .send({ assetId: asset.id, timeMs: 134000 });
    expect(queued.status).toBe(201);
    expect(queued.body.type).toBe("THUMBNAIL");
    expect(queued.body.params.timeMs).toBe(134000);

    await runWorkerCycle();
    const jobs = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    const thumb = jobs.body.find((job: any) => job.type === "THUMBNAIL");
    expect(thumb.status).toBe("SUCCEEDED");
    expect(thumb.result.demo).toBe(true);
  });
});

describe("M3 — the Lock release", () => {
  it("downloads are blocked while the lock is on", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);
    await runWorkerCycle();

    const detail = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}`);
    const proxy = detail.body.files.find((file: any) => file.kind === "PROXY");

    state.userId = "captain-1";
    const blocked = await request(API).get(
      `/api/video/projects/${project.id}/files/${proxy.id}/download`,
    );
    expect(blocked.status).toBe(403);
  });

  it("approving the FINISH leg releases the lock and audits downloads", async () => {
    const project = await createProject();
    await addMember(project.id, "sound@example.com", "AUDIO");
    const asset = await uploadAsset(project.id);
    await runWorkerCycle();

    // Before the release, download is blocked even for the Captain.
    const detail = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}`);
    const proxy = detail.body.files.find((file: any) => file.kind === "PROXY");
    state.userId = "captain-1";
    expect(
      (await request(API).get(`/api/video/projects/${project.id}/files/${proxy.id}/download`)).status,
    ).toBe(403);

    // Full relay: sound submits, Captain submits + approves the FINISH leg.
    const sound = await submitLeg(project.id, "SOUND", "sound-1", asset.id);
    expect(sound.status).toBe("SUBMITTED");
    const finish = await submitLeg(project.id, "FINISH", "captain-1", asset.id);
    expect(finish.status).toBe("SUBMITTED");

    state.userId = "captain-1";
    const approved = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${finish.id}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");

    // Project flipped to RELEASED.
    const after = await request(API).get(`/api/video/projects/${project.id}`);
    expect(after.body.status).toBe("RELEASED");

    // Downloads now open for the whole team, and are audited.
    state.userId = "sound-1";
    const downloaded = await request(API).get(
      `/api/video/projects/${project.id}/files/${proxy.id}/download`,
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.body).toBeInstanceOf(Buffer);

    state.userId = "captain-1";
    const trail = await request(API).get(`/api/video/projects/${project.id}/downloads`);
    expect(trail.status).toBe(200);
    expect(trail.body).toHaveLength(1);
    expect(trail.body[0].memberId).toBe("sound-1");
    expect(trail.body[0].fileId).toBe(proxy.id);
  });

  it("only the Captain can read the download audit trail", async () => {
    const project = await createProject();
    await addMember(project.id, "sound@example.com", "AUDIO");
    state.userId = "sound-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/downloads`)).status).toBe(403);
    state.userId = null;
    expect((await request(API).get(`/api/video/projects/${project.id}/downloads`)).status).toBe(401);
  });
});

describe("authorization on M3 routes", () => {
  it("rejects unauthenticated M3 requests", async () => {
    state.userId = null;
    expect((await request(API).post("/api/video/projects/x/audio").send({ action: "EQ" })).status).toBe(401);
    expect((await request(API).post("/api/video/projects/x/exports").send({ formats: ["16:9"] })).status).toBe(401);
    expect((await request(API).post("/api/video/projects/x/thumbnail").send({ assetId: "a", timeMs: 0 })).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/files/y/download")).status).toBe(401);
  });
});
