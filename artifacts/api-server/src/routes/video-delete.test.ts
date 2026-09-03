import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { _setStore, type ObjectStore } from "../video/object-storage";
import { tandemUid } from "../lib/tandem-uid";

process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "video-delete-test-"));
process.env.TANDEM_MEDIA_DEMO = "1";

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

/** Fake store that mimics R2's project-prefixed namespace. */
class FakeR2Store implements ObjectStore {
  objects = new Map<string, string>();
  private key(projectId: string, storageKey: string): string {
    return `projects/${projectId}/${storageKey}`;
  }
  async put(projectId: string, storageKey: string, filePath: string): Promise<{ sizeBytes: number }> {
    const bytes = fs.readFileSync(filePath);
    this.objects.set(this.key(projectId, storageKey), bytes.toString("utf8"));
    return { sizeBytes: bytes.length };
  }
  async getToFile(projectId: string, storageKey: string, filePath: string): Promise<void> {
    const data = this.objects.get(this.key(projectId, storageKey));
    if (!data) throw new Error("missing");
    fs.writeFileSync(filePath, data, "utf8");
  }
  async exists(projectId: string, storageKey: string): Promise<boolean> {
    return this.objects.has(this.key(projectId, storageKey));
  }
  async getUrl(): Promise<string | null> {
    return "https://presigned.r2.example/get";
  }
  async putUrl(): Promise<string | null> {
    return null;
  }
  async delete(): Promise<void> {}
  async deleteKeys(projectId: string, storageKeys: string[]): Promise<number> {
    let removed = 0;
    for (const storageKey of storageKeys) {
      if (this.objects.delete(this.key(projectId, storageKey))) removed += 1;
    }
    return removed;
  }
  async deleteProject(projectId: string): Promise<number> {
    const prefix = `projects/${projectId}/`;
    let removed = 0;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

const fake = new FakeR2Store();

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoJobsTable);
  await state.db.delete(t.tandemVideoAssetFilesTable);
  await state.db.delete(t.tandemVideoAssetsTable);
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
  fake.objects.clear();
}

let seedCounter = 0;
async function seedProject(owner = "owner-1") {
  const t = state.tables;
  const projectId = tandemUid(`p${seedCounter}`);
  seedCounter += 1;
  await state.db.insert(t.tandemVideoProjectsTable).values({ id: projectId, ownerId: owner, name: "Proj" });
  await state.db.insert(t.tandemVideoMembersTable).values({ id: tandemUid(`m${seedCounter}`), projectId, userId: owner, roles: ["CAPTAIN"] });
  return projectId;
}

function seedObject(projectId: string, storageKey: string, content = "bytes"): void {
  fake.objects.set(`projects/${projectId}/${storageKey}`, content);
}

function writeLocal(key: string): void {
  const p = path.join(process.env.VIDEO_UPLOAD_DIR!, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "local-bytes");
}

beforeEach(async () => {
  _setStore(fake);
  await resetDb();
  state.userId = "owner-1";
});

afterEach(() => {
  _setStore(null);
  state.userId = null;
});

describe("asset delete reclaims storage", () => {
  it("removes the asset rows and its R2 objects but not a local blob another asset shares", async () => {
    const t = state.tables;
    const projectId = await seedProject();
    const assetA = tandemUid(`a${seedCounter++}`);
    const assetB = tandemUid(`b${seedCounter++}`);

    // Asset A owns the R2 original + proxy. Asset B reuses A's LOCAL blob
    // (content-addressed: same storageKey, no own file rows).
    await state.db.insert(t.tandemVideoAssetsTable).values([
      { id: assetA, projectId, uploaderId: "owner-1", kind: "RAW_VIDEO", fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: 10, storageKey: "raw/shared.mp4", storageProvider: "local", contentHash: "hash-a", status: "PROCESSED" },
      { id: assetB, projectId, uploaderId: "owner-1", kind: "RAW_VIDEO", fileName: "b.mp4", mimeType: "video/mp4", sizeBytes: 10, storageKey: "raw/shared.mp4", storageProvider: "local", contentHash: "hash-b", status: "PROCESSED" },
    ]);
    await state.db.insert(t.tandemVideoAssetFilesTable).values([
      { id: tandemUid("f"), assetId: assetA, kind: "ORIGINAL", storageKey: "originals/a.mp4", storageProvider: "r2", mimeType: "video/mp4", sizeBytes: 10 },
      { id: tandemUid("f2"), assetId: assetA, kind: "PROXY", storageKey: "proxies/a.mp4", storageProvider: "r2", mimeType: "video/mp4", sizeBytes: 4 },
    ]);
    writeLocal("raw/shared.mp4");
    seedObject(projectId, "originals/a.mp4");
    seedObject(projectId, "proxies/a.mp4");

    const res = await request(API).delete(`/api/video/projects/${projectId}/assets/${assetA}`);
    expect(res.status).toBe(204);

    // Rows gone.
    const assets = await state.db.select().from(t.tandemVideoAssetsTable).where(eq(t.tandemVideoAssetsTable.id, assetA));
    expect(assets).toHaveLength(0);
    const fileRows = await state.db.select().from(t.tandemVideoAssetFilesTable).where(eq(t.tandemVideoAssetFilesTable.assetId, assetA));
    expect(fileRows).toHaveLength(0);

    // A's R2 objects reclaimed; the shared local blob survives for B.
    expect(fake.objects.has(`projects/${projectId}/originals/a.mp4`)).toBe(false);
    expect(fake.objects.has(`projects/${projectId}/proxies/a.mp4`)).toBe(false);
    expect(fs.existsSync(path.join(process.env.VIDEO_UPLOAD_DIR!, "raw/shared.mp4"))).toBe(true);
  });

  it("denies a non-uploader, non-captain member", async () => {
    const t = state.tables;
    const projectId = await seedProject();
    await state.db.insert(t.tandemVideoMembersTable).values({ id: tandemUid(`mv${seedCounter++}`), projectId, userId: "viewer-1", roles: ["VIEWER"] });
    const assetId = tandemUid(`a${seedCounter++}`);
    await state.db.insert(t.tandemVideoAssetsTable).values({ id: assetId, projectId, uploaderId: "owner-1", kind: "RAW_VIDEO", fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: 1, storageKey: "raw/a.mp4", storageProvider: "local", status: "UPLOADED" });

    state.userId = "viewer-1";
    const res = await request(API).delete(`/api/video/projects/${projectId}/assets/${assetId}`);
    expect(res.status).toBe(403);
  });
});

describe("project delete wipes the project's R2 prefix", () => {
  it("removes the project's R2 objects and leaves other projects' objects untouched", async () => {
    const t = state.tables;
    const projectA = await seedProject("owner-1");
    const projectB = await seedProject("owner-1");
    const assetA = tandemUid(`a${seedCounter++}`);
    await state.db.insert(t.tandemVideoAssetsTable).values({ id: assetA, projectId: projectA, uploaderId: "owner-1", kind: "RAW_VIDEO", fileName: "a.mp4", mimeType: "video/mp4", sizeBytes: 10, storageKey: "raw/a.mp4", storageProvider: "local", contentHash: "h", status: "PROCESSED" });
    await state.db.insert(t.tandemVideoAssetFilesTable).values({ id: tandemUid(`f${seedCounter++}`), assetId: assetA, kind: "PROXY", storageKey: "proxies/a.mp4", storageProvider: "r2", mimeType: "video/mp4", sizeBytes: 4 });
    writeLocal("raw/a.mp4");
    seedObject(projectA, "proxies/a.mp4");
    seedObject(projectB, "proxies/b.mp4");

    const res = await request(API).delete(`/api/video/projects/${projectA}`);
    expect(res.status).toBe(204);

    expect(fake.objects.has(`projects/${projectA}/proxies/a.mp4`)).toBe(false);
    expect(fake.objects.has(`projects/${projectB}/proxies/b.mp4`)).toBe(true);
    // The asset's local file was only referenced by project A's rows — gone.
    expect(fs.existsSync(path.join(process.env.VIDEO_UPLOAD_DIR!, "raw/a.mp4"))).toBe(false);
  });
});
