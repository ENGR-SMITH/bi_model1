import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  tandemVideoAssetsTable,
  tandemVideoAssetFilesTable,
  tandemVideoTranscriptsTable,
  tandemVideoTranscriptSegmentsTable,
} from "@workspace/db";
import type { TandemVideoAsset } from "@workspace/db";
import { enqueueAssetJobs, uploadDir } from "./worker";
import { ensureOriginalRestored, persistArtifact, r2Configured } from "./object-storage";
import { logger } from "../lib/logger";

/** Restores an existing asset's original to the processing disk when only the
 * durable R2 copy survived a restart. Used by the dedupe check so a pointer
 * to the blob stays valid. */
async function restoreOriginalSource(asset: {
  id: string;
  projectId: string;
  storageKey: string;
}): Promise<boolean> {
  return ensureOriginalRestored({
    id: asset.id,
    projectId: asset.projectId,
    storageKey: asset.storageKey,
    storageProvider: "local",
  });
}

// ---------------------------------------------------------------------------
// Content-addressed media (VCS design §6 — "Media = Git LFS"). Every uploaded
// original is addressed by the SHA-256 of its bytes; an identical re-upload
// reuses the stored blob (a pointer, never a copy) and its derived previews.
// ---------------------------------------------------------------------------

/** Streams a file and returns its SHA-256 hex digest — the content address. */
export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Returns the earliest vault asset whose original bytes match `contentHash`,
 * so an upload can reuse that blob instead of storing a second copy. Content
 * is the address, so the lookup spans every project (legacy rows uploaded
 * before hashing existed carry no hash and are skipped).
 */
export async function findAssetByContentHash(
  contentHash: string,
): Promise<TandemVideoAsset | null> {
  const [existing] = await db
    .select()
    .from(tandemVideoAssetsTable)
    .where(eq(tandemVideoAssetsTable.contentHash, contentHash))
    .orderBy(asc(tandemVideoAssetsTable.createdAt))
    .limit(1);
  return existing ?? null;
}

/**
 * Same-project variant: reuses only blobs this project already owns. Derived
 * artifacts (proxies/stems/thumbnails) live under the owning project's R2
 * prefix, so pointing a second PROJECT at them would couple the two projects'
 * storage lifecycles; keeping R2-backed reuse within one project keeps
 * project deletion self-contained. Local originals are still deduped vault-
 * wide (they are one flat blob on the processing disk, not per-project).
 */
async function findSameProjectMatch(
  contentHash: string,
  projectId: string,
): Promise<TandemVideoAsset | null> {
  const [existing] = await db
    .select()
    .from(tandemVideoAssetsTable)
    .where(and(eq(tandemVideoAssetsTable.contentHash, contentHash), eq(tandemVideoAssetsTable.projectId, projectId)))
    .orderBy(asc(tandemVideoAssetsTable.createdAt))
    .limit(1);
  return existing ?? null;
}

// Artifacts that are purely a function of the bytes (proxy previews, audio
// stems, thumbnail frames) can be pointed at by any asset with identical
// content. RENDER / EXPORT / INTERCHANGE rows are timeline- or job-scoped
// deliverables, not content addresses, so they stay per-asset.
const REUSABLE_KINDS = new Set(["PROXY", "AUDIO_STEM", "THUMBNAIL"]);

/**
 * Reuses a matched asset's derived previews (proxy/stem/thumbnail file rows +
 * transcript) for a new asset whose bytes are identical, so a new pass never
 * re-encodes or re-transcribes unchanged footage. Returns which artifacts were
 * reused so the caller can enqueue jobs for the missing ones.
 */
export async function reuseDerivedArtifacts(
  source: TandemVideoAsset,
  targetAssetId: string,
): Promise<{ proxy: boolean; transcript: boolean }> {
  const files = await db
    .select()
    .from(tandemVideoAssetFilesTable)
    .where(eq(tandemVideoAssetFilesTable.assetId, source.id));
  const reusable = files.filter((file) => REUSABLE_KINDS.has(file.kind));

  for (const file of reusable) {
    await db.insert(tandemVideoAssetFilesTable).values({
      id: randomUUID(),
      assetId: targetAssetId,
      kind: file.kind,
      storageKey: file.storageKey,
      contentHash: file.contentHash,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      metadata: file.metadata,
    });
  }

  const [transcript] = await db
    .select()
    .from(tandemVideoTranscriptsTable)
    .where(eq(tandemVideoTranscriptsTable.assetId, source.id))
    .limit(1);

  if (transcript) {
    const segments = await db
      .select()
      .from(tandemVideoTranscriptSegmentsTable)
      .where(eq(tandemVideoTranscriptSegmentsTable.transcriptId, transcript.id));

    const transcriptId = randomUUID();
    await db.insert(tandemVideoTranscriptsTable).values({
      id: transcriptId,
      assetId: targetAssetId,
      language: transcript.language,
      model: transcript.model,
      status: transcript.status,
    });
    if (segments.length > 0) {
      await db.insert(tandemVideoTranscriptSegmentsTable).values(
        segments.map((segment) => ({
          id: randomUUID(),
          transcriptId,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text,
          speaker: segment.speaker,
        })),
      );
    }
  }

  return {
    proxy: reusable.some((file) => file.kind === "PROXY"),
    transcript: Boolean(transcript),
  };
}

export interface CreatedAsset {
  asset: TandemVideoAsset;
  /** Final status: "UPLOADED" (jobs pending) or "PROCESSED" (previews ready). */
  status: string;
  /** True when the bytes already existed and the stored blob was reused. */
  deduplicated: boolean;
}

/**
 * Lands one uploaded file as a vault asset (shared by the vault upload route
 * and the interchange import's optional media attachment): hashes the bytes,
 * dedupes against existing content (reusing the stored blob + derived
 * previews when identical), and enqueues proxy/transcribe jobs only for what
 * wasn't reusable. The caller owns realtime emissions.
 */
export async function createAssetFromUpload(opts: {
  projectId: string;
  uploaderId: string;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Absolute path multer wrote the file to. */
  filePath: string;
  /** The multer storage key (basename of filePath). */
  storageKey: string;
}): Promise<CreatedAsset> {
  const contentHash = await hashFile(opts.filePath);
  // Content-addressed reuse. The physical blob is the vault-wide flat file on
  // the processing disk; when the earliest copy has been evicted but a durable
  // R2 copy exists, restore it so the pointer still works. Legacy rows carry
  // no hash and are skipped.
  const existing = await findAssetByContentHash(contentHash);
  const reuseBlob =
    existing !== null && (fs.existsSync(path.join(uploadDir(), existing.storageKey)) || (await restoreOriginalSource(existing)));

  // Derived artifacts (proxies/stems/thumbnails) are only reused within the
  // SAME project — they live under that project's R2 prefix, and project
  // deletion wipes the prefix. Cross-project duplicates re-encode (the local
  // blob is still shared, which is the disk win).
  const sameProject = reuseBlob && existing!.projectId === opts.projectId ? existing : null;

  let storageKey = opts.storageKey;
  if (reuseBlob) {
    // The address is already stored once — discard the duplicate bytes.
    fs.unlinkSync(opts.filePath);
    storageKey = existing!.storageKey;
  }

  // Browser-path uploads (<500 MB, per the web tier) get a durable R2 copy
  // of the original so a container restart can never lose the footage. The
  // asset keeps pointing at its local processing-disk file (the worker reads
  // that path); the R2 copy is tracked as an ORIGINAL asset-file row and
  // restored back to the local path by ensureLocalCopy when the disk is
  // evicted. Skipped for web-ready kinds (THUMBNAIL_DESIGN) whose bytes ARE
  // the proxy.
  const r2OriginalKey =
    !reuseBlob &&
    r2Configured() &&
    opts.sizeBytes < 500 * 1024 * 1024 &&
    opts.kind !== "THUMBNAIL_DESIGN"
      ? `originals/${randomUUID()}${path.extname(opts.fileName).slice(0, 12).toLowerCase()}`
      : null;

  const [asset] = await db
    .insert(tandemVideoAssetsTable)
    .values({
      id: randomUUID(),
      projectId: opts.projectId,
      uploaderId: opts.uploaderId,
      kind: opts.kind,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      sizeBytes: opts.sizeBytes,
      durationMs: null,
      storageKey,
      storageProvider: "local",
      contentHash,
      status: "UPLOADED",
      version: 0,
    })
    .returning();

  if (r2OriginalKey) {
    try {
      // Persist the multer file (still on disk: !reuseBlob) as the durable
      // copy, then record the ORIGINAL row that restore/delete can use.
      const provider = await persistArtifact(opts.projectId, r2OriginalKey, opts.filePath, opts.mimeType || "application/octet-stream");
      if (provider === "r2") {
        await db.insert(tandemVideoAssetFilesTable).values({
          id: randomUUID(),
          assetId: asset.id,
          kind: "ORIGINAL",
          storageKey: r2OriginalKey,
          storageProvider: "r2",
          contentHash,
          mimeType: opts.mimeType || "application/octet-stream",
          sizeBytes: opts.sizeBytes,
          metadata: { durable: true },
        });
      }
    } catch (error) {
      // Best-effort durability copy — a failure must not block the upload
      // (the file is still on the processing disk and jobs can run).
      logger.warn({ projectId: opts.projectId, err: error }, "R2 durability copy failed; continuing without it");
    }
  }

  // A designed thumbnail is already a web-ready image — it needs no ffmpeg
  // proxy or whisper transcript. The original doubles as the preview file.
  let status = "UPLOADED";
  if (opts.kind === "THUMBNAIL_DESIGN") {
    status = "PROCESSED";
    await db.insert(tandemVideoAssetFilesTable).values({
      id: randomUUID(),
      assetId: asset.id,
      kind: "PROXY",
      storageKey: asset.storageKey,
      contentHash: asset.contentHash,
      mimeType: opts.mimeType || "image/png",
      sizeBytes: opts.sizeBytes,
      metadata: { demo: false, degraded: false, original: true },
    });
    await db
      .update(tandemVideoAssetsTable)
      .set({ status: "PROCESSED" })
      .where(eq(tandemVideoAssetsTable.id, asset.id));
  } else if (reuseBlob && sameProject) {
    // Reuse the matched blob's previews instead of re-encoding/re-transcribing
    // unchanged footage; enqueue jobs only for what wasn't reusable. Only the
    // same-project match qualifies — cross-project reuses re-encode locally.
    const reused = await reuseDerivedArtifacts(sameProject, asset.id);
    const missing: Array<"PROXY" | "TRANSCRIBE"> = [];
    if (!reused.proxy) missing.push("PROXY");
    if (!reused.transcript) missing.push("TRANSCRIBE");
    if (missing.length === 0) {
      status = "PROCESSED";
      await db
        .update(tandemVideoAssetsTable)
        .set({ status: "PROCESSED" })
        .where(eq(tandemVideoAssetsTable.id, asset.id));
    } else {
      await enqueueAssetJobs(asset, missing);
    }
  } else {
    // Kick off proxy + transcription; the in-process worker picks these up.
    await enqueueAssetJobs(asset);
  }

  return { asset, status, deduplicated: reuseBlob };
}

export interface ContentHashBackfillResult {
  /** Legacy rows scanned (contentHash IS NULL). */
  legacy: number;
  /** Rows whose content address was written. */
  hashed: number;
  /** Rows skipped because the file is gone from disk. */
  missingFiles: number;
}

/**
 * One-time backfill for assets uploaded before content addressing existed:
 * hashes every legacy original (contentHash IS NULL) and records the address
 * on the asset row and on any of its asset_files rows that point at the same
 * physical file (e.g. THUMBNAIL_DESIGN and demo-mode PROXY rows).
 *
 * Non-destructive: duplicate copies already on disk are left in place, so
 * future uploads of the same bytes dedupe against the earliest copy without
 * this pass deleting anything. Rows whose file is gone from disk are skipped
 * (counted) — they cannot be addressed.
 */
export async function backfillContentHashes(
  uploadDirPath: string,
): Promise<ContentHashBackfillResult> {
  const legacy = await db
    .select()
    .from(tandemVideoAssetsTable)
    .where(isNull(tandemVideoAssetsTable.contentHash));

  const result: ContentHashBackfillResult = {
    legacy: legacy.length,
    hashed: 0,
    missingFiles: 0,
  };

  for (const asset of legacy) {
    const filePath = path.join(uploadDirPath, asset.storageKey);
    if (!fs.existsSync(filePath)) {
      result.missingFiles += 1;
      continue;
    }

    const contentHash = await hashFile(filePath);
    await db
      .update(tandemVideoAssetsTable)
      .set({ contentHash })
      .where(eq(tandemVideoAssetsTable.id, asset.id));
    // Rows that reference the original blob directly share its address.
    await db
      .update(tandemVideoAssetFilesTable)
      .set({ contentHash })
      .where(
        and(
          eq(tandemVideoAssetFilesTable.assetId, asset.id),
          eq(tandemVideoAssetFilesTable.storageKey, asset.storageKey),
        ),
      );
    result.hashed += 1;
  }

  return result;
}

export interface ContentConsolidationResult {
  /** Content hashes that had more than one physical copy on disk. */
  hashes: number;
  /** asset_files rows repointed at the kept copy (planned count, also in dry-run). */
  rowsRepointed: number;
  /** asset rows repointed at the kept copy (planned count, also in dry-run). */
  assetsRepointed: number;
  /** Duplicate files deleted from disk (always 0 in dry-run). */
  filesDeleted: number;
  /** Bytes freed on disk (or that would be freed, in dry-run). */
  bytesReclaimed: number;
  /** Duplicate keys whose file was already gone from disk. */
  missingFiles: number;
}

/**
 * Optional follow-up to the backfill: reclaim the disk that legacy duplicates
 * still occupy. For every content hash with more than one physical copy, the
 * earliest copy is kept and the rest are deleted, with all rows (asset_files
 * and assets) repointed at the kept blob — same "earliest wins" rule as
 * `findAssetByContentHash`.
 *
 * Defaults to `dryRun: true` from the CLI — pass `--apply` to actually delete.
 * A hash is skipped entirely (counted as missing) when its kept copy is gone
 * from disk, so consolidation can never orphan the last remaining copy.
 */
export async function consolidateContentHashes(
  uploadDirPath: string,
  opts: { dryRun?: boolean } = {},
): Promise<ContentConsolidationResult> {
  const dryRun = opts.dryRun ?? false;
  const result: ContentConsolidationResult = {
    hashes: 0,
    rowsRepointed: 0,
    assetsRepointed: 0,
    filesDeleted: 0,
    bytesReclaimed: 0,
    missingFiles: 0,
  };

  const fileRows = await db
    .select()
    .from(tandemVideoAssetFilesTable)
    .where(isNotNull(tandemVideoAssetFilesTable.contentHash));

  // Group file rows by content hash, remembering the earliest row (the keeper)
  // and how many rows reference each distinct storage key.
  const groups = new Map<
    string,
    { earliest: (typeof fileRows)[number]; keys: Map<string, number> }
  >();
  for (const row of fileRows) {
    if (!row.contentHash) continue;
    let group = groups.get(row.contentHash);
    if (!group) {
      group = { earliest: row, keys: new Map() };
      groups.set(row.contentHash, group);
    }
    group.keys.set(row.storageKey, (group.keys.get(row.storageKey) ?? 0) + 1);
    if (
      row.createdAt.getTime() < group.earliest.createdAt.getTime() ||
      (row.createdAt.getTime() === group.earliest.createdAt.getTime() &&
        row.id < group.earliest.id)
    ) {
      group.earliest = row;
    }
  }

  const canonicalByHash = new Map<string, string>();
  for (const [hash, group] of groups) {
    canonicalByHash.set(hash, group.earliest.storageKey);
    if (group.keys.size < 2) continue;

    const keeper = group.earliest.storageKey;
    if (!fs.existsSync(path.join(uploadDirPath, keeper))) {
      // The kept copy is gone — never consolidate onto a missing blob.
      result.missingFiles += 1;
      continue;
    }
    result.hashes += 1;

    for (const [key, count] of group.keys) {
      if (key === keeper) continue;
      const filePath = path.join(uploadDirPath, key);
      if (fs.existsSync(filePath)) {
        result.bytesReclaimed += fs.statSync(filePath).size;
        if (!dryRun) {
          fs.unlinkSync(filePath);
          result.filesDeleted += 1;
        }
      } else {
        result.missingFiles += 1;
      }
      result.rowsRepointed += count;
      if (!dryRun) {
        await db
          .update(tandemVideoAssetFilesTable)
          .set({ storageKey: keeper })
          .where(
            and(
              eq(tandemVideoAssetFilesTable.contentHash, hash),
              eq(tandemVideoAssetFilesTable.storageKey, key),
            ),
          );
      }
    }
  }

  // Assets: repoint each row's storageKey at the canonical blob for its hash
  // (hashes that only ever lived on assets use the earliest asset's key).
  const assetRows = await db
    .select()
    .from(tandemVideoAssetsTable)
    .where(isNotNull(tandemVideoAssetsTable.contentHash));
  for (const asset of assetRows) {
    if (!asset.contentHash || canonicalByHash.has(asset.contentHash)) continue;
    canonicalByHash.set(asset.contentHash, asset.storageKey);
  }

  for (const asset of assetRows) {
    if (!asset.contentHash) continue;
    const canonical = canonicalByHash.get(asset.contentHash);
    if (!canonical || asset.storageKey === canonical) continue;
    if (!fs.existsSync(path.join(uploadDirPath, canonical))) {
      result.missingFiles += 1;
      continue;
    }
    const oldKey = asset.storageKey;
    result.assetsRepointed += 1;
    if (!dryRun) {
      await db
        .update(tandemVideoAssetsTable)
        .set({ storageKey: canonical })
        .where(eq(tandemVideoAssetsTable.id, asset.id));
      // Unlink the old file only once nothing references it anymore.
      const [stillAsset] = await db
        .select({ id: tandemVideoAssetsTable.id })
        .from(tandemVideoAssetsTable)
        .where(eq(tandemVideoAssetsTable.storageKey, oldKey))
        .limit(1);
      const [stillFile] = await db
        .select({ id: tandemVideoAssetFilesTable.id })
        .from(tandemVideoAssetFilesTable)
        .where(eq(tandemVideoAssetFilesTable.storageKey, oldKey))
        .limit(1);
      const oldPath = path.join(uploadDirPath, oldKey);
      if (!stillAsset && !stillFile && fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
        result.filesDeleted += 1;
      }
    }
  }

  return result;
}
