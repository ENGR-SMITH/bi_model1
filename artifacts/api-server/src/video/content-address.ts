import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  db,
  tandemVideoAssetsTable,
  tandemVideoAssetFilesTable,
  tandemVideoTranscriptsTable,
  tandemVideoTranscriptSegmentsTable,
} from "@workspace/db";
import type { TandemVideoAsset } from "@workspace/db";
import { enqueueAssetJobs, uploadDir } from "./worker";

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
 * is the address, so the lookup is vault-wide (any project). Legacy rows
 * uploaded before hashing existed carry no hash and are skipped.
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
  const existing = await findAssetByContentHash(contentHash);
  const reuseBlob =
    existing !== null && fs.existsSync(path.join(uploadDir(), existing.storageKey));

  let storageKey = opts.storageKey;
  if (reuseBlob) {
    // The address is already stored once — discard the duplicate bytes.
    fs.unlinkSync(opts.filePath);
    storageKey = existing!.storageKey;
  }

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
      contentHash,
      status: "UPLOADED",
      version: 0,
    })
    .returning();

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
  } else if (reuseBlob) {
    // Reuse the matched blob's previews instead of re-encoding/re-transcribing
    // unchanged footage; enqueue jobs only for what wasn't reusable.
    const reused = await reuseDerivedArtifacts(existing!, asset.id);
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
