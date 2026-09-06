import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { DEFAULT_PROJECT_LIMIT, DEFAULT_STORAGE_LIMIT_BYTES } from "../video/quota";

// Uploads land on disk; point multer at a throwaway temp dir for tests.
process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "account-test-"));

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
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
import accountRouter from "./account";

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { warn: () => {}, info: () => {}, error: () => {} };
    next();
  });
  app.use("/api", videoRouter);
  app.use("/api", videoProductionRouter);
  app.use("/api", accountRouter);
  return app;
}

const API = createApp();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemUserCvsTable);
  await state.db.delete(t.tandemAccountQuotasTable);
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

describe("account quota", () => {
  it("returns the free defaults (2 GB storage, 5 projects) on first use", async () => {
    state.userId = "captain-1";
    const res = await request(API).get("/api/account/quota");
    expect(res.status).toBe(200);
    expect(res.body.storageBytes.totalBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES);
    expect(res.body.storageBytes.usedBytes).toBe(0);
    expect(res.body.storageBytes.remainingBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES);
    expect(res.body.projects.total).toBe(DEFAULT_PROJECT_LIMIT);
    expect(res.body.projects.used).toBe(0);
    expect(res.body.plans.storage.some((plan: any) => plan.id === "g500" && plan.priceUsd === 4000)).toBe(true);
    expect(res.body.plans.storage.some((plan: any) => plan.id === "g200" && plan.priceUsd === 2000)).toBe(true);
    expect(res.body.plans.storage.some((plan: any) => plan.id === "tb1" && plan.priceUsd === 6000)).toBe(true);
    expect(res.body.plans.projects.some((plan: any) => plan.id === "p10" && plan.priceUsd === 500)).toBe(true);
    expect(res.body.plans.projects.some((plan: any) => plan.id === "p50" && plan.priceUsd === 2000)).toBe(true);
    expect(res.body.plans.projects.some((plan: any) => plan.id === "p200" && plan.priceUsd === 5000)).toBe(true);
  });

  it("counts vault asset bytes of owned projects as used storage", async () => {
    const project = await createProject("captain-1");
    state.userId = "captain-1";
    const upload = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("x".repeat(4096)), "clip.mp4");
    expect(upload.status).toBe(201);

    const res = await request(API).get("/api/account/quota");
    expect(res.status).toBe(200);
    expect(res.body.storageBytes.usedBytes).toBe(4096);
    expect(res.body.storageBytes.remainingBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES - 4096);
    expect(res.body.projects.used).toBe(1);

    // A member who is not the owner contributes nothing to their own usage.
    await createProject("captain-2", "Someone else's film");
    state.userId = "user-2";
    const memberQuota = await request(API).get("/api/account/quota");
    expect(memberQuota.body.storageBytes.usedBytes).toBe(0);
    expect(memberQuota.body.projects.used).toBe(0);
  });

  it("applies buy-more plans to the account limit", async () => {
    state.userId = "captain-1";
    const storage = await request(API)
      .post("/api/account/quota/purchase")
      .send({ kind: "storage", planId: "g500" });
    expect(storage.status).toBe(200);
    expect(storage.body.storageBytes.totalBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES + 500 * 1024 ** 3);
    expect(storage.body.purchased).toMatchObject({ kind: "storage", planId: "g500", priceUsd: 4000 });

    const projects = await request(API)
      .post("/api/account/quota/purchase")
      .send({ kind: "projects", planId: "p50" });
    expect(projects.status).toBe(200);
    expect(projects.body.projects.total).toBe(DEFAULT_PROJECT_LIMIT + 50);

    // Purchases persist — a fresh read reflects the new limits.
    const read = await request(API).get("/api/account/quota");
    expect(read.body.storageBytes.totalBytes).toBe(DEFAULT_STORAGE_LIMIT_BYTES + 500 * 1024 ** 3);
    expect(read.body.projects.total).toBe(DEFAULT_PROJECT_LIMIT + 50);
  });

  it("rejects unknown plans", async () => {
    state.userId = "captain-1";
    expect((await request(API).post("/api/account/quota/purchase").send({ kind: "storage", planId: "nope" })).status).toBe(400);
    expect((await request(API).post("/api/account/quota/purchase").send({ kind: "projects", planId: "nope" })).status).toBe(400);
    expect((await request(API).post("/api/account/quota/purchase").send({ kind: "other", planId: "g200" })).status).toBe(400);
  });

  it("rejects uploads that exceed the account's remaining storage", async () => {
    const project = await createProject("captain-1");
    state.userId = "captain-1";

    // Shrink the account's quota so a small test upload overflows it.
    await request(API).get("/api/account/quota"); // materialize the default row
    await state.db
      .update(state.tables.tandemAccountQuotasTable)
      .set({ storageLimitBytes: 2048 })
      .where(eq(state.tables.tandemAccountQuotasTable.userId, "captain-1"));

    const blocked = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("x".repeat(4096)), "too-big.mp4");
    expect(blocked.status).toBe(413);
    expect(blocked.body.error).toMatch(/storage limit/i);

    // The rejected file was discarded — nothing landed in the vault.
    const assets = await request(API).get(`/api/video/projects/${project.id}/assets`);
    expect(assets.body).toHaveLength(0);

    // Raising the limit lets the same upload through.
    await state.db
      .update(state.tables.tandemAccountQuotasTable)
      .set({ storageLimitBytes: 10 * 1024 * 1024 })
      .where(eq(state.tables.tandemAccountQuotasTable.userId, "captain-1"));
    const ok = await request(API)
      .post(`/api/video/projects/${project.id}/assets`)
      .field("kind", "RAW_VIDEO")
      .attach("file", Buffer.from("x".repeat(4096)), "fits-now.mp4");
    expect(ok.status).toBe(201);
  });

  it("requires authentication", async () => {
    state.userId = null;
    expect((await request(API).get("/api/account/quota")).status).toBe(401);
    expect((await request(API).post("/api/account/quota/purchase").send({ kind: "storage", planId: "g200" })).status).toBe(401);
  });
});

describe("user CV", () => {
  it("uploads, reads, and streams a CV", async () => {
    state.userId = "captain-1";
    const upload = await request(API)
      .post("/api/users/captain-1/cv")
      .attach("file", Buffer.from("%PDF-1.4 fake cv content"), "ada-cv.pdf");
    expect(upload.status).toBe(201);
    expect(upload.body.fileName).toBe("ada-cv.pdf");
    expect(upload.body.userId).toBe("captain-1");
    expect(upload.body.sizeBytes).toBeGreaterThan(0);

    const meta = await request(API).get("/api/users/captain-1/cv");
    expect(meta.status).toBe(200);
    expect(meta.body.fileName).toBe("ada-cv.pdf");

    const file = await request(API).get("/api/users/captain-1/cv/file");
    expect(file.status).toBe(200);
    expect(Buffer.from(file.body).toString()).toContain("%PDF-1.4 fake cv content");
  });

  it("lets other signed-in users view the CV but not manage it", async () => {
    state.userId = "captain-1";
    await request(API).post("/api/users/captain-1/cv").attach("file", Buffer.from("cv"), "ada-cv.pdf");

    state.userId = "stranger-1";
    expect((await request(API).get("/api/users/captain-1/cv")).status).toBe(200);
    expect((await request(API).get("/api/users/captain-1/cv/file")).status).toBe(200);
    expect((await request(API).post("/api/users/captain-1/cv").attach("file", Buffer.from("x"), "x.pdf")).status).toBe(403);
    expect((await request(API).delete("/api/users/captain-1/cv")).status).toBe(403);
  });

  it("replaces an existing CV on re-upload", async () => {
    state.userId = "captain-1";
    await request(API).post("/api/users/captain-1/cv").attach("file", Buffer.from("v1"), "v1.pdf");
    const replace = await request(API)
      .post("/api/users/captain-1/cv")
      .attach("file", Buffer.from("v2-longer"), "v2.pdf");
    expect(replace.status).toBe(200);
    expect(replace.body.fileName).toBe("v2.pdf");
    expect(replace.body.sizeBytes).toBe("v2-longer".length);

    const meta = await request(API).get("/api/users/captain-1/cv");
    expect(meta.body.fileName).toBe("v2.pdf");
    const file = await request(API).get("/api/users/captain-1/cv/file");
    expect(Buffer.from(file.body).toString()).toBe("v2-longer");
  });

  it("deletes the CV and reports 404 afterwards", async () => {
    state.userId = "captain-1";
    await request(API).post("/api/users/captain-1/cv").attach("file", Buffer.from("cv"), "ada-cv.pdf");

    const del = await request(API).delete("/api/users/captain-1/cv");
    expect(del.status).toBe(200);
    expect(del.body.deleted).toBe(true);
    expect((await request(API).get("/api/users/captain-1/cv")).status).toBe(404);
    expect((await request(API).delete("/api/users/captain-1/cv")).status).toBe(404);
  });

  it("requires authentication", async () => {
    state.userId = null;
    expect((await request(API).get("/api/users/captain-1/cv")).status).toBe(401);
    expect((await request(API).post("/api/users/captain-1/cv").attach("file", Buffer.from("x"), "x.pdf")).status).toBe(401);
    expect((await request(API).delete("/api/users/captain-1/cv")).status).toBe(401);
  });
});
