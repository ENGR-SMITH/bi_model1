import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { nexetUid } from "../lib/nexet-uid";
import { _setStore, type ObjectStore } from "./object-storage";

process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-recovery-test-"));

const state = vi.hoisted(() => ({
  db: null as any,
  tables: null as any,
}));

vi.mock("@workspace/db", async () => {
  const { buildInMemoryDb } = await import("../test/in-memory-db");
  const built = await buildInMemoryDb();
  state.db = built.db;
  state.tables = built.tables;
  return built.exports;
});

import { logger } from "../lib/logger";
import {
  PROXY_MAX_ATTEMPTS,
  recoverStuckProxies,
  recoverStuckProxy,
  recoverStuckProxyJobs,
} from "./proxy-recovery";

/** Fake store that mimics R2's project-prefixed namespace (same shape as
 * routes/video-delete.test.ts uses). */
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
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
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

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;
const ORIGINAL_STALE_MINUTES = process.env.PROXY_STALE_RUNNING_MINUTES;

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.nexetVideoJobsTable);
  await state.db.delete(t.nexetVideoAssetFilesTable);
  await state.db.delete(t.nexetVideoAssetsTable);
  await state.db.delete(t.nexetVideoMembersTable);
  await state.db.delete(t.nexetVideoProjectsTable);
}

beforeEach(async () => {
  delete process.env.REDIS_URL;
  _setStore(fake);
  fake.objects.clear();
  await resetDb();
});

afterEach(() => {
  _setStore(null);
  if (ORIGINAL_REDIS_URL === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  }
  if (ORIGINAL_STALE_MINUTES === undefined) {
    delete process.env.PROXY_STALE_RUNNING_MINUTES;
  } else {
    process.env.PROXY_STALE_RUNNING_MINUTES = ORIGINAL_STALE_MINUTES;
  }
  vi.restoreAllMocks();
});

let seedCounter = 0;

/** A vault asset that is old enough to be recovered (uploaded 10 min ago). */
async function seedAsset(
  opts: { status?: string; kind?: string; createdAt?: Date; withLocalSource?: boolean } = {},
) {
  const t = state.tables;
  const projectId = nexetUid(`p${seedCounter++}`);
  await state.db.insert(t.nexetVideoProjectsTable).values({ id: projectId, ownerId: "owner-1", name: "Proj" });
  const assetId = nexetUid(`a${seedCounter++}`);
  const storageKey = `raw/${assetId}.mp4`;
  await state.db.insert(t.nexetVideoAssetsTable).values({
    id: assetId,
    projectId,
    uploaderId: "owner-1",
    kind: opts.kind ?? "RAW_VIDEO",
    fileName: "a.mp4",
    mimeType: "video/mp4",
    sizeBytes: 10,
    storageKey,
    storageProvider: "local",
    status: opts.status ?? "UPLOADED",
    createdAt: opts.createdAt ?? new Date(Date.now() - 10 * 60 * 1000),
  });
  if (opts.withLocalSource !== false) {
    writeLocalSource(storageKey);
  }
  const [asset] = await state.db
    .select()
    .from(t.nexetVideoAssetsTable)
    .where(eq(t.nexetVideoAssetsTable.id, assetId));
  return asset;
}

function writeLocalSource(storageKey: string): void {
  const filePath = path.join(process.env.VIDEO_UPLOAD_DIR!, storageKey);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "original-bytes");
}

async function addJob(
  asset: { id: string; projectId: string },
  opts: { status?: string; startedAt?: Date; error?: string } = {},
) {
  const t = state.tables;
  const id = nexetUid(`j${seedCounter++}`);
  await state.db.insert(t.nexetVideoJobsTable).values({
    id,
    projectId: asset.projectId,
    assetId: asset.id,
    type: "PROXY",
    status: opts.status ?? "FAILED",
    attempts: 1,
    error: opts.error ?? "ffmpeg proxy encode failed (exit 1)",
    startedAt: opts.startedAt ?? new Date(Date.now() - 9 * 60 * 1000),
  });
  return id;
}

async function proxyJobsFor(assetId: string) {
  const t = state.tables;
  return state.db
    .select()
    .from(t.nexetVideoJobsTable)
    .where(eq(t.nexetVideoJobsTable.assetId, assetId));
}

async function addProxyFile(asset: { id: string }, opts: { pending?: boolean } = {}) {
  const t = state.tables;
  await state.db.insert(t.nexetVideoAssetFilesTable).values({
    id: nexetUid(`f${seedCounter++}`),
    assetId: asset.id,
    kind: "PROXY",
    storageKey: `proxies/${asset.id}.mp4`,
    storageProvider: "r2",
    mimeType: "video/mp4",
    sizeBytes: 4,
    metadata: opts.pending ? { pending: true } : { uploaded: true },
  });
}

describe("stuck-proxy recovery", () => {
  it("re-queues a PROXY job for an asset whose run failed", async () => {
    const asset = await seedAsset();
    await addJob(asset);

    const jobId = await recoverStuckProxy(asset);

    expect(jobId).toBeTruthy();
    const jobs = await proxyJobsFor(asset.id);
    expect(jobs).toHaveLength(2);
    expect(jobs.filter((job: { status: string }) => job.status === "QUEUED")).toHaveLength(1);
  });

  it("re-queues when the upload never got a job row at all", async () => {
    const asset = await seedAsset();

    const jobId = await recoverStuckProxy(asset);

    expect(jobId).toBeTruthy();
    expect(await proxyJobsFor(asset.id)).toHaveLength(1);
  });

  it("never duplicates a job that is still queued", async () => {
    const asset = await seedAsset();
    await addJob(asset, { status: "QUEUED" });

    expect(await recoverStuckProxy(asset)).toBeNull();
    expect(await proxyJobsFor(asset.id)).toHaveLength(1);
  });

  it("leaves an asset alone once a proxy file exists", async () => {
    const asset = await seedAsset();
    await addJob(asset);
    await addProxyFile(asset);

    expect(await recoverStuckProxy(asset)).toBeNull();
    expect(await proxyJobsFor(asset.id)).toHaveLength(1);
  });

  it("does not fight a pending desktop-agent proxy upload", async () => {
    const asset = await seedAsset();
    await addJob(asset);
    await addProxyFile(asset, { pending: true });

    expect(await recoverStuckProxy(asset)).toBeNull();
    expect(await proxyJobsFor(asset.id)).toHaveLength(1);
  });

  it("stops re-queueing once the attempt budget is spent", async () => {
    const asset = await seedAsset();
    for (let attempt = 0; attempt < PROXY_MAX_ATTEMPTS; attempt += 1) {
      await addJob(asset);
    }

    expect(await recoverStuckProxy(asset)).toBeNull();
    expect(await proxyJobsFor(asset.id)).toHaveLength(PROXY_MAX_ATTEMPTS);
  });

  it("reports instead of queueing when the source is gone and no durable copy exists", async () => {
    const asset = await seedAsset({ withLocalSource: false });
    await addJob(asset, { error: "Source file is missing locally and no R2 copy could be restored" });

    expect(await recoverStuckProxy(asset)).toBeNull();
    expect(await proxyJobsFor(asset.id)).toHaveLength(1);
  });

  it("restores a durable copy when only the local disk copy was lost", async () => {
    const asset = await seedAsset({ withLocalSource: false });
    const t = state.tables;
    const durableKey = `originals/${asset.id}.mp4`;
    await state.db.insert(t.nexetVideoAssetFilesTable).values({
      id: nexetUid(`o${seedCounter++}`),
      assetId: asset.id,
      kind: "ORIGINAL",
      storageKey: durableKey,
      storageProvider: "r2",
      mimeType: "video/mp4",
      sizeBytes: 10,
      metadata: { durable: true },
    });
    fake.objects.set(`projects/${asset.projectId}/${durableKey}`, "original-bytes");

    const jobId = await recoverStuckProxy(asset);

    expect(jobId).toBeTruthy();
    expect(fs.existsSync(path.join(process.env.VIDEO_UPLOAD_DIR!, asset.storageKey))).toBe(true);
  });

  it("skips processed, held-for-review, and already-previewable kinds", async () => {
    const processed = await seedAsset({ status: "PROCESSED" });
    const pending = await seedAsset({ status: "PENDING_REVIEW" });
    const thumb = await seedAsset({ kind: "THUMBNAIL_DESIGN" });

    await recoverStuckProxies([processed, pending, thumb]);

    for (const asset of [processed, pending, thumb]) {
      expect(await proxyJobsFor(asset.id)).toHaveLength(0);
    }
  });

  it("leaves a freshly uploaded asset to its own upload request", async () => {
    const asset = await seedAsset({ createdAt: new Date() });

    expect(await recoverStuckProxy(asset)).toBeNull();
    expect(await proxyJobsFor(asset.id)).toHaveLength(0);
  });

  it("reclaims a RUNNING job left behind by a server that stopped mid-job", async () => {
    const asset = await seedAsset();
    const staleJobId = await addJob(asset, {
      status: "RUNNING",
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    const jobId = await recoverStuckProxy(asset);

    expect(jobId).toBeTruthy();
    const jobs = await proxyJobsFor(asset.id);
    const stale = jobs.find((job: { id: string }) => job.id === staleJobId);
    expect(stale.status).toBe("FAILED");
    expect(stale.error).toContain("Interrupted");
    expect(jobs.filter((job: { status: string }) => job.status === "QUEUED")).toHaveLength(1);
  });

  it("gives a young RUNNING job more time", async () => {
    const asset = await seedAsset();
    await addJob(asset, { status: "RUNNING", startedAt: new Date() });

    expect(await recoverStuckProxy(asset)).toBeNull();
    const jobs = await proxyJobsFor(asset.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("RUNNING");
  });

  it("respects PROXY_STALE_RUNNING_MINUTES", async () => {
    process.env.PROXY_STALE_RUNNING_MINUTES = "1";
    const asset = await seedAsset();
    await addJob(asset, { status: "RUNNING", startedAt: new Date(Date.now() - 2 * 60 * 1000) });

    expect(await recoverStuckProxy(asset)).toBeTruthy();
  });

  it("leaves RUNNING rows to the worker fleet in BullMQ mode", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const asset = await seedAsset();
    await addJob(asset, { status: "RUNNING", startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) });

    expect(await recoverStuckProxy(asset)).toBeNull();
    const jobs = await proxyJobsFor(asset.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("RUNNING");
  });

  it("sweeps only assets that are old enough and still missing a preview", async () => {
    const stuck = await seedAsset();
    await addJob(stuck);
    await seedAsset({ createdAt: new Date() }); // still uploading
    await seedAsset({ status: "PROCESSED" });

    const result = await recoverStuckProxyJobs();

    expect(result).toEqual({ scanned: 1, requeued: 1 });
    expect(await proxyJobsFor(stuck.id)).toHaveLength(2);
  });

  it("counts a sweep cycle's re-queues", async () => {
    const fresh = await seedAsset({ createdAt: new Date() });

    // Nothing eligible yet: the budget guard must not requeue on every cycle.
    expect(await recoverStuckProxyJobs()).toEqual({ scanned: 0, requeued: 0 });
    expect(await proxyJobsFor(fresh.id)).toHaveLength(0);
  });

  it("names the missing worker fleet when BullMQ queues go unconsumed", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    const warn = vi.spyOn(logger, "warn");
    const t = state.tables;
    const asset = await seedAsset();
    // Queued six minutes ago: nobody is claiming the queue.
    await state.db.insert(t.nexetVideoJobsTable).values({
      id: nexetUid(`q${seedCounter++}`),
      projectId: asset.projectId,
      assetId: asset.id,
      type: "PROXY",
      status: "QUEUED",
      createdAt: new Date(Date.now() - 6 * 60 * 1000),
    });

    await recoverStuckProxyJobs();

    expect(warn.mock.calls.some(([, message]) => String(message).includes("worker fleet"))).toBe(true);
    // The queued job is claimed work, not dead work — never duplicated.
    expect(await proxyJobsFor(asset.id)).toHaveLength(1);
  });

  it("stays quiet about queues when Redis is not in play", async () => {
    const warn = vi.spyOn(logger, "warn");

    await recoverStuckProxyJobs();

    expect(warn.mock.calls.some(([, message]) => String(message).includes("worker fleet"))).toBe(false);
  });
});
