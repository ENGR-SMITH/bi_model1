import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "storage-maint-test-"));
process.env.TANDEM_MEDIA_DEMO = "1";
process.env.ORIGINAL_RETENTION_DAYS = "30";

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

import { runStorageMetering, runStorageRetention } from "./storage-maintenance";
import { localPathFor } from "./object-storage";
import { tandemUid } from "../lib/tandem-uid";

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoAssetFilesTable);
  await state.db.delete(t.tandemVideoAssetsTable);
  await state.db.delete(t.tandemVideoMembersTable);
  await state.db.delete(t.tandemVideoProjectsTable);
  await state.db.delete(t.tandemVideoStorageSnapshotsTable);
}

beforeEach(resetDb);
afterEach(resetDb);

function writeLocalFile(key: string, bytes: number): void {
  const p = localPathFor(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.alloc(bytes, 1));
}

describe("storage metering snapshots", () => {
  it("records actual bytes per project, split r2 vs local, without double-counting ORIGINAL rows", async () => {
    const t = state.tables;
    const projectId = tandemUid("p");
    await state.db.insert(t.tandemVideoProjectsTable).values({ id: projectId, ownerId: "captain-1", name: "Metering" });

    // One asset: 1000-byte original (local disk) + 1000-byte durable R2 copy
    // (ORIGINAL row, should not double count) + 300-byte R2 proxy + 50-byte
    // local demo file.
    const assetId = tandemUid("a");
    await state.db.insert(t.tandemVideoAssetsTable).values({
      id: assetId,
      projectId,
      uploaderId: "captain-1",
      kind: "RAW_VIDEO",
      fileName: "cam.mp4",
      mimeType: "video/mp4",
      sizeBytes: 1000,
      storageKey: "originals/durable.mp4",
      storageProvider: "r2",
      contentHash: "abc",
      status: "PROCESSED",
    });
    await state.db.insert(t.tandemVideoAssetFilesTable).values([
      { id: tandemUid("f1"), assetId, kind: "ORIGINAL", storageKey: "originals/durable.mp4", storageProvider: "r2", mimeType: "video/mp4", sizeBytes: 1000 },
      { id: tandemUid("f2"), assetId, kind: "PROXY", storageKey: "proxies/p.mp4", storageProvider: "r2", mimeType: "video/mp4", sizeBytes: 300 },
      { id: tandemUid("f3"), assetId, kind: "THUMBNAIL", storageKey: "proxies/t.jpg", storageProvider: "local", mimeType: "image/jpeg", sizeBytes: 50 },
    ]);

    const recorded = await runStorageMetering("2026-09-03");
    expect(recorded).toBe(1);

    const [snap] = await state.db
      .select()
      .from(t.tandemVideoStorageSnapshotsTable)
      .where(eq(t.tandemVideoStorageSnapshotsTable.projectId, projectId));
    // Original (1000) counted once via the asset row; ORIGINAL row skipped;
    // proxy 300 r2 + thumbnail 50 local on top.
    expect(snap.r2Bytes).toBe(300);
    expect(snap.localBytes).toBe(1050);
    expect(snap.totalBytes).toBe(1350);
  });

  it("upserts idempotently for the same project/day", async () => {
    const t = state.tables;
    const projectId = tandemUid("p");
    await state.db.insert(t.tandemVideoProjectsTable).values({ id: projectId, ownerId: "captain-1", name: "Metering2" });
    await runStorageMetering("2026-09-03");
    await runStorageMetering("2026-09-03");
    const rows = await state.db.select().from(t.tandemVideoStorageSnapshotsTable).where(eq(t.tandemVideoStorageSnapshotsTable.projectId, projectId));
    expect(rows).toHaveLength(1);
  });
});

describe("storage retention sweep", () => {
  it("reclaims the local original only when a durable R2 copy AND a proxy exist", async () => {
    const t = state.tables;
    const projectId = tandemUid("p");
    await state.db.insert(t.tandemVideoProjectsTable).values({ id: projectId, ownerId: "captain-1", name: "Retention" });

    const seed = async (assetId: string, daysOld: number, opts: { durable: boolean; proxy: boolean }) => {
      await state.db.insert(t.tandemVideoAssetsTable).values({
        id: assetId,
        projectId,
        uploaderId: "captain-1",
        kind: "RAW_VIDEO",
        fileName: `${assetId}.mp4`,
        mimeType: "video/mp4",
        sizeBytes: 500,
        storageKey: `raw/${assetId}.mp4`,
        storageProvider: "local",
        contentHash: assetId,
        status: "PROCESSED",
        createdAt: new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000),
      });
      writeLocalFile(`raw/${assetId}.mp4`, 500);
      const rows: any[] = [];
      if (opts.durable) {
        rows.push({ id: tandemUid(`fo-${assetId.slice(-6)}`), assetId, kind: "ORIGINAL", storageKey: `originals/${assetId}.mp4`, storageProvider: "r2", mimeType: "video/mp4", sizeBytes: 500 });
      }
      if (opts.proxy) {
        rows.push({ id: tandemUid(`fp-${assetId.slice(-6)}`), assetId, kind: "PROXY", storageKey: `proxies/${assetId}.mp4`, storageProvider: "r2", mimeType: "video/mp4", sizeBytes: 200 });
      }
      if (rows.length) await state.db.insert(t.tandemVideoAssetFilesTable).values(rows);
    };

    const oldDurable = tandemUid("oldok");
    const oldNoProxy = tandemUid("np");
    const oldNoDurable = tandemUid("nd");
    const freshDurable = tandemUid("fresh");
    const oldShared = tandemUid("shared");
    const sharer = tandemUid("sharer");
    await seed(oldDurable, 40, { durable: true, proxy: true });
    await seed(oldNoProxy, 40, { durable: true, proxy: false });
    await seed(oldNoDurable, 40, { durable: false, proxy: true });
    await seed(freshDurable, 0, { durable: true, proxy: true });
    // oldShared's local blob is ALSO referenced by `sharer` (dedupe): even
    // though oldShared itself qualifies, the shared file must survive.
    await seed(oldShared, 40, { durable: true, proxy: true });
    await state.db.insert(t.tandemVideoAssetsTable).values({
      id: sharer,
      projectId,
      uploaderId: "captain-1",
      kind: "RAW_VIDEO",
      fileName: `${sharer}.mp4`,
      mimeType: "video/mp4",
      sizeBytes: 500,
      storageKey: `raw/${oldShared}.mp4`,
      storageProvider: "local",
      contentHash: sharer,
      status: "UPLOADED",
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    const reclaimed = await runStorageRetention();
    expect(reclaimed).toBe(1);

    expect(fs.existsSync(localPathFor(`raw/${oldDurable}.mp4`))).toBe(false);
    expect(fs.existsSync(localPathFor(`raw/${oldNoProxy}.mp4`))).toBe(true);
    expect(fs.existsSync(localPathFor(`raw/${oldNoDurable}.mp4`))).toBe(true);
    expect(fs.existsSync(localPathFor(`raw/${freshDurable}.mp4`))).toBe(true);
    expect(fs.existsSync(localPathFor(`raw/${oldShared}.mp4`))).toBe(true);
  });
});
