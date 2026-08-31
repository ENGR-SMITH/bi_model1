import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tandemUid } from "../lib/tandem-uid";
import { _setStore, type ObjectStore } from "../video/object-storage";

process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "video-storage-test-"));
process.env.TANDEM_MEDIA_DEMO = "1";
// Simulate an R2-configured server so the presigned flow activates.
process.env.CF_ACCOUNT_ID = "test-account";
process.env.CF_R2_ACCESS_KEY = "test-key";
process.env.CF_R2_SECRET_KEY = "test-secret";
process.env.CF_R2_BUCKET = "test-bucket";

const state = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as any,
  tables: null as any,
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: state.userId }),
  clerkClient: { users: { getUserList: async () => ({ data: [] }) } },
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import { eq } from "drizzle-orm";
import videoRouter from "./video";
import videoProductionRouter from "./video-production";
import videoStorageRouter from "./video-storage";
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
  app.use("/api", videoStorageRouter);
  return app;
}

const API = createApp();

// In-memory ObjectStore fake: shares the exact key namespace the real store uses.
class FakeR2Store implements ObjectStore {
  objects = new Map<string, string>();

  async put(projectId: string, storageKey: string, filePath: string): Promise<{ sizeBytes: number }> {
    const key = `projects/${projectId}/${storageKey}`;
    const bytes = fs.readFileSync(filePath);
    this.objects.set(key, bytes.toString("utf8"));
    return { sizeBytes: bytes.length };
  }
  async getToFile(projectId: string, storageKey: string, filePath: string): Promise<void> {
    const data = this.objects.get(`projects/${projectId}/${storageKey}`);
    if (!data) throw new Error("missing");
    fs.writeFileSync(filePath, data, "utf8");
  }
  async exists(projectId: string, storageKey: string): Promise<boolean> {
    return this.objects.has(`projects/${projectId}/${storageKey}`);
  }
  async getUrl(): Promise<string | null> {
    return "https://presigned.r2.example/get-object";
  }
  async putUrl(projectId: string, storageKey: string): Promise<string | null> {
    return `https://presigned.r2.example/put/${projectId}/${encodeURIComponent(storageKey)}`;
  }
  async delete(): Promise<void> {}
}

const fake = new FakeR2Store();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoJobsTable);
  await state.db.delete(t.tandemVideoAssetFilesTable);
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
}

async function seedProjectAndMember() {
  const t = state.tables;
  const ownerId = "owner-1";
  const projectId = tandemUid("p");
  await state.db
    .insert(t.tandemVideoProjectsTable)
    .values({ id: projectId, ownerId, name: "Proj", status: "VAULT" });
  await state.db
    .insert(t.tandemVideoMembersTable)
    .values({ id: tandemUid("m"), projectId, userId: ownerId, roles: ["CAPTAIN"] });
  return { ownerId, projectId };
}

beforeEach(async () => {
  _setStore(fake);
  fake.objects.clear();
  await resetDb();
  state.userId = "owner-1";
});

afterEach(() => {
  _setStore(null);
  state.userId = null;
});

describe("R2 presigned proxy upload (desktop-agent flow)", () => {
  it("rejects without authentication", async () => {
    state.userId = null;
    const res = await request(API)
      .post("/api/video/projects/p1/assets/a1/proxy-upload-url")
      .send({ fileSize: 1024 });
    expect(res.status).toBe(401);
  });

  it("rejects a non-member", async () => {
    state.userId = "stranger";
    const { projectId } = await seedProjectAndMember();
    const res = await request(API)
      .post(`/api/video/projects/${projectId}/assets/nope/proxy-upload-url`)
      .send({ fileSize: 1024 });
    expect(res.status).toBe(403);
  });

  it("mints a presigned PUT, records a pending proxy row, then confirms", async () => {
    const t = state.tables;
    const { projectId, ownerId } = await seedProjectAndMember();

    // Upload a raw original (the multipart path — stays local).
    const upload = await request(API)
      .post(`/api/video/projects/${projectId}/assets`)
      .attach("file", Buffer.from("fake video bytes"), "clip.mp4");
    expect(upload.status).toBe(201);
    const assetId = upload.body.id;

    // Approve the pending raw asset so a proxy can attach to it.
    await state.db
      .update(t.tandemVideoAssetsTable)
      .set({ status: "PROCESSING" })
      .where(eq(t.tandemVideoAssetsTable.id, assetId));

    const mint = await request(API)
      .post(`/api/video/projects/${projectId}/assets/${assetId}/proxy-upload-url`)
      .send({ filename: "clip_720p.mp4", fileSize: 4096, mimeType: "video/mp4" });
    expect(mint.status).toBe(200);
    expect(mint.body.storageKey).toBe("proxies/" + assetId + ".mp4");
    expect(mint.body.uploadUrl).toContain("/put/");

    // Confirm — the fake "already has" the object (we seeded it).
    fake.objects.set(`projects/${projectId}/proxies/${assetId}.mp4`, "proxy-bytes");
    const confirm = await request(API)
      .post(`/api/video/projects/${projectId}/assets/${assetId}/proxy-ready`);
    expect(confirm.status).toBe(200);

    const rows = (await state.db
      .select()
      .from(t.tandemVideoAssetFilesTable)
      .where(eq(t.tandemVideoAssetFilesTable.assetId, assetId))) as Array<{
      id: string;
      kind: string;
      storageProvider: string;
      sizeBytes: number;
      mimeType: string;
      metadata: Record<string, unknown> | null;
    }>;
    const proxyRow = rows.find((r) => r.kind === "PROXY")!;
    expect(proxyRow).toBeTruthy();
    expect(proxyRow.storageProvider).toBe("r2");
    expect((proxyRow.metadata ?? {}).uploaded).toBe(true);

    // The proxy stream route now redirects to a presigned GET.
    const stream = await request(API).get(
      `/api/video/projects/${projectId}/assets/${assetId}/proxy`,
    );
    expect(stream.status).toBe(302);
    expect(stream.headers.location).toContain("presigned.r2.example");

    // Sanity: the in-process worker still runs without error alongside R2.
    await runWorkerCycle();
  });
});