import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Uploads + proxies land on disk; demo mode keeps processing deterministic
// (no ffmpeg/faster-whisper required) and off the machine's real tooling.
process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "video-prod-test-"));
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
      getUserList: async ({ emailAddress }: { emailAddress: string[] }) => {
        const email = emailAddress[0];
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
  state.clerkEmailToUser = {
    "architect@example.com": "architect-1",
    "editor@example.com": "editor-1",
    "stranger@example.com": "stranger-1",
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
    .send({ email, role });
  expect(res.status).toBe(201);
}

async function uploadAsset(projectId: string, fileName = "interview-cam-a.mp4") {
  const res = await request(API)
    .post(`/api/video/projects/${projectId}/assets`)
    .field("kind", "RAW_VIDEO")
    .attach("file", Buffer.from("fake video bytes"), fileName);
  expect(res.status).toBe(201);
  return res.body as any;
}

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker pipeline (demo mode)", () => {
  it("uploads enqueue PROXY + TRANSCRIBE jobs and the worker processes them", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);

    const queued = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    expect(queued.status).toBe(200);
    const types = queued.body.map((job: any) => job.type).sort();
    expect(types).toEqual(["PROXY", "TRANSCRIBE"]);
    expect(queued.body.every((job: any) => job.status === "QUEUED")).toBe(true);

    await runWorkerCycle();

    const after = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    expect(after.body.every((job: any) => job.status === "SUCCEEDED")).toBe(true);

    const detail = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.files.some((file: any) => file.kind === "PROXY")).toBe(true);
    expect(detail.body.transcript).not.toBeNull();
    expect(detail.body.transcript.status).toBe("DEMO");
    expect(detail.body.transcript.segments.length).toBeGreaterThan(0);
    expect(detail.body.transcript.segments[0].text).toContain("Demo transcript");
  });

  it("marks the asset PROCESSED once both jobs succeed", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);
    await runWorkerCycle();

    const detail = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}`);
    expect(detail.body.status).toBe("PROCESSED");
  });

  it("streams the proxy file to members only", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);
    await runWorkerCycle();

    state.userId = "captain-1";
    const stream = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}/proxy`);
    expect(stream.status).toBe(200);
    expect(stream.body).toBeInstanceOf(Buffer);

    state.userId = "stranger-1";
    const forbidden = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}/proxy`);
    expect(forbidden.status).toBe(403);
  });

  it("returns 404 for a proxy before processing runs", async () => {
    const project = await createProject();
    const asset = await uploadAsset(project.id);
    const res = await request(API).get(`/api/video/projects/${project.id}/assets/${asset.id}/proxy`);
    expect(res.status).toBe(404);
  });
});

describe("timelines (Git-style versions)", () => {
  it("returns an empty timeline state before anything is saved", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const res = await request(API).get(`/api/video/projects/${project.id}/timelines/SELECTS`);
    expect(res.status).toBe(200);
    expect(res.body.leg).toBe("SELECTS");
    expect(res.body.version).toBeNull();
    expect(res.body.versions).toEqual([]);
  });

  it("saves snapshots as versions and lists history newest first", async () => {
    const project = await createProject();
    await addMember(project.id, "architect@example.com", "ARCHITECT");

    state.userId = "architect-1";
    const first = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: "a1", inMs: 0, outMs: 5000 }] }, message: "Hook and setup" });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(1);
    expect(first.body.versions).toHaveLength(1);

    const second = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: "a1", inMs: 0, outMs: 5000 }, { id: "c2", assetId: "a1", inMs: 5000, outMs: 9000 }] }, message: "Add the payoff" });
    expect(second.status).toBe(200);
    expect(second.body.version).toBe(2);
    expect(second.body.versions).toHaveLength(2);
    expect(second.body.versions[0].version).toBe(2);
    expect(second.body.versions[0].message).toBe("Add the payoff");
  });

  it("only the leg role (or Captain) can save a timeline", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VISUAL_EDITOR");

    state.userId = "editor-1";
    const forbidden = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [] } });
    expect(forbidden.status).toBe(403);

    state.userId = "architect-1"; // not a member
    const notMember = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [] } });
    expect(notMember.status).toBe(403);
  });

  it("rollback restores a previous snapshot as a new head version", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "v1clip" }] }, message: "v1" });
    const second = await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "v2clip" }] }, message: "v2" });
    expect(second.body.snapshot.clips[0].id).toBe("v2clip");

    const targetId = second.body.versions[1].id; // v1
    const rolled = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/SELECTS/rollback`)
      .send({ versionId: targetId });
    expect(rolled.status).toBe(200);
    expect(rolled.body.snapshot.clips[0].id).toBe("v1clip");
    expect(rolled.body.version).toBe(3);
    expect(rolled.body.versions).toHaveLength(3);
  });
});

describe("submissions (Captain review)", () => {
  it("submits the current snapshot, then the Captain approves", async () => {
    const project = await createProject();
    await addMember(project.id, "architect@example.com", "ARCHITECT");

    state.userId = "architect-1";
    const noSnapshot = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS", note: "nothing saved" });
    expect(noSnapshot.status).toBe(400);

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [{ id: "c1" }] }, message: "The selects" });

    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS", note: "Ready for review" });
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe("SUBMITTED");

    const duplicate = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS" });
    expect(duplicate.status).toBe(409);

    state.userId = "captain-1";
    const approved = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/approve`,
    );
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("APPROVED");
    expect(approved.body.decidedById).toBe("captain-1");
    expect(approved.body.decidedAt).not.toBeNull();
  });

  it("only the Captain can approve or reject", async () => {
    const project = await createProject();
    await addMember(project.id, "architect@example.com", "ARCHITECT");
    state.userId = "architect-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/SELECTS`)
      .send({ snapshot: { clips: [] } });
    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "SELECTS" });

    state.userId = "architect-1";
    const forbidden = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/reject`,
    );
    expect(forbidden.status).toBe(403);

    state.userId = "captain-1";
    const rejected = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/reject`,
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("REJECTED");

    const redecide = await request(API).post(
      `/api/video/projects/${project.id}/submissions/${submitted.body.id}/approve`,
    );
    expect(redecide.status).toBe(409);
  });
});

describe("timecode comments", () => {
  it("creates, lists, and resolves comments", async () => {
    const project = await createProject();
    state.userId = "captain-1";
    const created = await request(API)
      .post(`/api/video/projects/${project.id}/comments`)
      .send({ leg: "SELECTS", timecodeMs: 134000, body: "The lighting shift at 02:14 is jarring." });
    expect(created.status).toBe(201);
    expect(created.body.timecodeMs).toBe(134000);

    const list = await request(API).get(`/api/video/projects/${project.id}/comments`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const patch = await request(API)
      .patch(`/api/video/projects/${project.id}/comments/${created.body.id}`)
      .send({ resolved: true });
    expect(patch.status).toBe(200);
    expect(patch.body.resolvedAt).not.toBeNull();

    const reopened = await request(API)
      .patch(`/api/video/projects/${project.id}/comments/${created.body.id}`)
      .send({ resolved: false });
    expect(reopened.body.resolvedAt).toBeNull();
  });

  it("only the author or Captain can resolve", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VISUAL_EDITOR");
    state.userId = "captain-1";
    const created = await request(API)
      .post(`/api/video/projects/${project.id}/comments`)
      .send({ body: "Check this beat." });

    state.userId = "editor-1";
    const forbidden = await request(API)
      .patch(`/api/video/projects/${project.id}/comments/${created.body.id}`)
      .send({ resolved: true });
    expect(forbidden.status).toBe(403);
  });

  it("rejects comments pinned to an asset from another project", async () => {
    const projectA = await createProject();
    const projectB = await createProject("captain-2", "Other Vlog");
    const asset = await uploadAsset(projectB.id); // uploads as captain-2 (owner of B)

    state.userId = "captain-1";
    const res = await request(API)
      .post(`/api/video/projects/${projectA.id}/comments`)
      .send({ assetId: asset.id, body: "Wrong project" });
    expect(res.status).toBe(400);
  });
});

describe("M2 — multi-cam sync (Visual Editor)", () => {
  it("queues a sync job (CUT role only) and the worker writes a sync pair", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VISUAL_EDITOR");
    const camA = await uploadAsset(project.id, "cam-a.mp4");
    const camB = await uploadAsset(project.id, "cam-b.mp4");

    state.userId = "architect-1"; // not a member
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/assets/${camA.id}/sync`)
      .send({ targetAssetId: camB.id });
    expect(forbidden.status).toBe(403);

    state.userId = "editor-1";
    const queued = await request(API)
      .post(`/api/video/projects/${project.id}/assets/${camA.id}/sync`)
      .send({ targetAssetId: camB.id });
    expect(queued.status).toBe(201);
    expect(queued.body.type).toBe("SYNC");
    expect(queued.body.status).toBe("QUEUED");
    expect(queued.body.params.targetAssetId).toBe(camB.id);

    await runWorkerCycle();

    const syncs = await request(API).get(`/api/video/projects/${project.id}/syncs`);
    expect(syncs.status).toBe(200);
    expect(syncs.body).toHaveLength(1);
    expect(syncs.body[0].primaryAssetId).toBe(camA.id);
    expect(syncs.body[0].targetAssetId).toBe(camB.id);
    expect(syncs.body[0].method).toBe("DEMO");
    expect(syncs.body[0].status).toBe("SYNCED");
  });

  it("rejects self-sync and cross-project sync targets", async () => {
    const projectA = await createProject();
    const projectB = await createProject("captain-2", "Other Vlog");
    await addMember(projectA.id, "editor@example.com", "VISUAL_EDITOR");
    const camA = await uploadAsset(projectA.id, "cam-a.mp4");
    state.userId = "captain-2";
    const otherCam = await uploadAsset(projectB.id, "other.mp4");

    state.userId = "editor-1";
    const selfSync = await request(API)
      .post(`/api/video/projects/${projectA.id}/assets/${camA.id}/sync`)
      .send({ targetAssetId: camA.id });
    expect(selfSync.status).toBe(400);

    const crossProject = await request(API)
      .post(`/api/video/projects/${projectA.id}/assets/${camA.id}/sync`)
      .send({ targetAssetId: otherCam.id });
    expect(crossProject.status).toBe(400);
  });

  it("requires membership to list syncs", async () => {
    const project = await createProject();
    state.userId = "stranger-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/syncs`)).status).toBe(403);
    state.userId = null;
    expect((await request(API).get(`/api/video/projects/${project.id}/syncs`)).status).toBe(401);
  });
});

describe("M2 — renders (preview + picture-lock)", () => {
  it("queues a preview render from the CUT snapshot", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VISUAL_EDITOR");
    const camA = await uploadAsset(project.id, "cam-a.mp4");

    state.userId = "editor-1";
    const noClips = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/render`)
      .send({ format: "PREVIEW" });
    expect(noClips.status).toBe(400);

    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: camA.id, inMs: 0, outMs: 8000 }] }, message: "First cut" });

    const queued = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/render`)
      .send({ format: "PREVIEW" });
    expect(queued.status).toBe(201);
    expect(queued.body.type).toBe("RENDER");
    expect(queued.body.params.format).toBe("PREVIEW");
    expect(queued.body.params.leg).toBe("CUT");

    // Dedupe: a second render while one is queued → 409.
    const duplicate = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/render`)
      .send({ format: "PREVIEW" });
    expect(duplicate.status).toBe(409);

    await runWorkerCycle();

    const jobs = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    const render = jobs.body.find((job: any) => job.type === "RENDER");
    expect(render.status).toBe("SUCCEEDED");
    expect(render.result.demo).toBe(true);
    expect(render.result.format).toBe("PREVIEW");
  });

  it("auto-queues a picture-lock render when the CUT leg is submitted", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VISUAL_EDITOR");
    const camA = await uploadAsset(project.id, "cam-a.mp4");

    state.userId = "editor-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: camA.id, inMs: 0, outMs: 8000 }] } });
    const submitted = await request(API)
      .post(`/api/video/projects/${project.id}/submissions`)
      .send({ leg: "CUT", note: "Picture locked" });
    expect(submitted.status).toBe(201);

    await runWorkerCycle();

    const jobs = await request(API).get(`/api/video/projects/${project.id}/jobs`);
    const renders = jobs.body.filter((job: any) => job.type === "RENDER");
    expect(renders.length).toBe(1);
    expect(renders[0].params.format).toBe("PICTURE_LOCK");
    expect(renders[0].status).toBe("SUCCEEDED");
  });

  it("only the leg role (or Captain) can queue a render", async () => {
    const project = await createProject();
    await addMember(project.id, "editor@example.com", "VISUAL_EDITOR");
    const camA = await uploadAsset(project.id, "cam-a.mp4");
    state.userId = "captain-1";
    await request(API)
      .put(`/api/video/projects/${project.id}/timelines/CUT`)
      .send({ snapshot: { clips: [{ id: "c1", assetId: camA.id, inMs: 0, outMs: 8000 }] } });

    state.userId = "architect-1"; // wrong leg role
    const forbidden = await request(API)
      .post(`/api/video/projects/${project.id}/timelines/CUT/render`)
      .send({ format: "PREVIEW" });
    expect(forbidden.status).toBe(403);
  });
});

describe("authorization on M1 routes", () => {
  it("rejects unauthenticated M1 requests", async () => {
    state.userId = null;
    expect((await request(API).get("/api/video/projects/x/assets/y")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/assets/y/proxy")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/timelines/SELECTS")).status).toBe(401);
    expect((await request(API).put("/api/video/projects/x/timelines/SELECTS").send({ snapshot: {} })).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/submissions")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/comments")).status).toBe(401);
    expect((await request(API).get("/api/video/projects/x/jobs")).status).toBe(401);
  });

  it("non-members are blocked from M1 reads", async () => {
    const project = await createProject();
    state.userId = "stranger-1";
    expect((await request(API).get(`/api/video/projects/${project.id}/assets/whatever`)).status).toBe(403);
    expect((await request(API).get(`/api/video/projects/${project.id}/timelines/SELECTS`)).status).toBe(403);
    expect((await request(API).get(`/api/video/projects/${project.id}/comments`)).status).toBe(403);
    expect((await request(API).get(`/api/video/projects/${project.id}/jobs`)).status).toBe(403);
  });
});
