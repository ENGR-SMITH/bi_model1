import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

process.env.VIDEO_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "content-address-test-"));

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

import { backfillContentHashes, findAssetByContentHash } from "./content-address";

async function resetDb() {
  const t = state.tables;
  await state.db.delete(t.tandemVideoTranscriptSegmentsTable);
  await state.db.delete(t.tandemVideoTranscriptsTable);
  await state.db.delete(t.tandemVideoAssetFilesTable);
  await state.db.delete(t.tandemVideoAssetsTable);
  await state.db.delete(t.tandemVideoProjectsTable);
}

async function seedProject(projectId = "project-1") {
  await state.db.insert(state.tables.tandemVideoProjectsTable).values({
    id: projectId,
    ownerId: "captain-1",
    name: "Legacy Room",
    description: "",
    status: "VAULT",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function seedLegacyAsset(opts: {
  id: string;
  projectId: string;
  storageKey: string;
  bytes: Buffer;
  contentHash?: string | null;
  fileName?: string;
}) {
  await state.db.insert(state.tables.tandemVideoAssetsTable).values({
    id: opts.id,
    projectId: opts.projectId,
    uploaderId: "captain-1",
    kind: "RAW_VIDEO",
    fileName: opts.fileName ?? path.basename(opts.storageKey),
    mimeType: "video/mp4",
    sizeBytes: opts.bytes.length,
    storageKey: opts.storageKey,
    contentHash: opts.contentHash ?? null,
    status: "PROCESSED",
    version: 0,
    createdAt: new Date(),
  });
}

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("content-hash backfill", () => {
  it("hashes legacy assets and their original-pointing file rows", async () => {
    const dir = process.env.VIDEO_UPLOAD_DIR!;
    const bytes = Buffer.from("legacy footage");
    const key = "legacy-1.mp4";
    fs.writeFileSync(path.join(dir, key), bytes);

    await seedProject();
    await seedLegacyAsset({ id: "asset-legacy", projectId: "project-1", storageKey: key, bytes });
    // A THUMBNAIL_DESIGN-style row referencing the original blob directly.
    await state.db.insert(state.tables.tandemVideoAssetFilesTable).values({
      id: "file-legacy",
      assetId: "asset-legacy",
      kind: "PROXY",
      storageKey: key,
      mimeType: "video/mp4",
      sizeBytes: bytes.length,
      metadata: { demo: true },
      createdAt: new Date(),
    });

    const result = await backfillContentHashes(dir);
    expect(result).toEqual({ legacy: 1, hashed: 1, missingFiles: 0 });

    const expected = crypto.createHash("sha256").update(bytes).digest("hex");
    const [row] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, "asset-legacy"));
    expect(row.contentHash).toBe(expected);

    const [file] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetFilesTable)
      .where(eq(state.tables.tandemVideoAssetFilesTable.id, "file-legacy"));
    expect(file.contentHash).toBe(expected);

    // A future upload of the same bytes now resolves to the legacy blob.
    expect((await findAssetByContentHash(expected))?.id).toBe("asset-legacy");
  });

  it("skips rows whose file is missing and leaves already-hashed rows alone", async () => {
    const dir = process.env.VIDEO_UPLOAD_DIR!;
    await seedProject();
    // File never written to disk — cannot be hashed.
    await seedLegacyAsset({
      id: "asset-gone",
      projectId: "project-1",
      storageKey: "gone.mp4",
      bytes: Buffer.from("ghost"),
    });
    // Already addressed (e.g. uploaded after the feature shipped).
    const hashedBytes = Buffer.from("already hashed");
    const hashedKey = "hashed.mp4";
    fs.writeFileSync(path.join(dir, hashedKey), hashedBytes);
    await seedLegacyAsset({
      id: "asset-hashed",
      projectId: "project-1",
      storageKey: hashedKey,
      bytes: hashedBytes,
      contentHash: crypto.createHash("sha256").update(hashedBytes).digest("hex"),
    });

    const result = await backfillContentHashes(dir);
    expect(result).toEqual({ legacy: 1, hashed: 0, missingFiles: 1 });

    const [row] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, "asset-hashed"));
    expect(row.contentHash).toBe(
      crypto.createHash("sha256").update(hashedBytes).digest("hex"),
    );
  });

  it("gives duplicate legacy copies the same address (earliest wins)", async () => {
    const dir = process.env.VIDEO_UPLOAD_DIR!;
    const bytes = Buffer.from("duplicated across sessions");
    await seedProject();
    const keys = ["dup-a.mp4", "dup-b.mp4"];
    for (const key of keys) {
      fs.writeFileSync(path.join(dir, key), bytes);
      await seedLegacyAsset({ id: `asset-${key}`, projectId: "project-1", storageKey: key, bytes });
    }

    const result = await backfillContentHashes(dir);
    expect(result.hashed).toBe(2);

    const expected = crypto.createHash("sha256").update(bytes).digest("hex");
    const [a] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, "asset-dup-a.mp4"));
    const [b] = await state.db
      .select()
      .from(state.tables.tandemVideoAssetsTable)
      .where(eq(state.tables.tandemVideoAssetsTable.id, "asset-dup-b.mp4"));
    expect(a.contentHash).toBe(expected);
    expect(b.contentHash).toBe(expected);
    expect((await findAssetByContentHash(expected))?.id).toBe("asset-dup-a.mp4");
  });
});
