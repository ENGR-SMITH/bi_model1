// ---------------------------------------------------------------------------
// Storage maintenance jobs — the metering + retention ledger behind the
// playbook's "you must meter and enforce limits or you run a charity" advice.
//
//   1. Metering (daily): record each project's ACTUAL stored bytes (originals
//      + derived artifacts, split r2 vs local) into storage snapshots — the
//      billing/history ledger. NOTE: quota ENFORCEMENT (the upload gate and
//      profile bar) does NOT read these rows; it computes live bytes on every
//      call so a user cannot overshoot between nightly runs. Snapshots are the
//      billing-grade record for day-over-day reporting and future invoices.
//   2. Retention (daily): originals are only needed locally while their proxy
//      pipeline runs. Once the proxy exists AND a durable R2 copy of the
//      original is in place, the local copy of an old original can be dropped
//      to reclaim the ephemeral processing disk. The R2 copy is never touched
//      here.
//
// Runs in-process on a timer (like the worker loop). Both sweeps are cheap,
// idempotent, and safe to run any number of times.
// ---------------------------------------------------------------------------

import { and, eq, inArray, lt } from "drizzle-orm";
import {
  db,
  tandemVideoAssetsTable,
  tandemVideoAssetFilesTable,
  tandemVideoProjectsTable,
  tandemVideoStorageSnapshotsTable,
} from "@workspace/db";
import fs from "node:fs";
import { logger } from "../lib/logger";
import { existsLocally, localPathFor } from "./object-storage";

/** Days an original is kept on the processing disk once its proxy is ready
 * and a durable R2 copy exists. Default follows the playbook's "raw files
 * deleted 30 days after project completion"; 0 disables local retention. */
export function originalRetentionDays(): number {
  const raw = Number(process.env.ORIGINAL_RETENTION_DAYS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 30;
}

function retentionCutoff(): Date | null {
  const days = originalRetentionDays();
  return days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
}

// ---------------------------------------------------------------------------
// Metering
// ---------------------------------------------------------------------------

/**
 * Compute one project's ACTUAL physical storage: every original (asset rows,
 * each billing its nominal size) plus every derived artifact (asset_files
 * rows) split by where the bytes live (r2 vs local). ORIGINAL-kind file rows
 * mirror the asset's own durable copy and are not double-counted.
 */
export async function projectStorageBytes(projectId: string): Promise<{
  totalBytes: number;
  r2Bytes: number;
  localBytes: number;
}> {
  const assets = await db
    .select({
      id: tandemVideoAssetsTable.id,
      sizeBytes: tandemVideoAssetsTable.sizeBytes,
    })
    .from(tandemVideoAssetsTable)
    .where(eq(tandemVideoAssetsTable.projectId, projectId));

  const assetIds = assets.map((a) => a.id);
  const files = assetIds.length
    ? await db
        .select({
          assetId: tandemVideoAssetFilesTable.assetId,
          sizeBytes: tandemVideoAssetFilesTable.sizeBytes,
          storageProvider: tandemVideoAssetFilesTable.storageProvider,
          kind: tandemVideoAssetFilesTable.kind,
        })
        .from(tandemVideoAssetFilesTable)
        .where(inArray(tandemVideoAssetFilesTable.assetId, assetIds))
    : [];

  let totalBytes = 0;
  let r2Bytes = 0;
  let localBytes = 0;
  const add = (bytes: number, provider: string | null) => {
    totalBytes += bytes;
    if (provider === "r2") r2Bytes += bytes;
    else localBytes += bytes;
  };

  for (const asset of assets) add(asset.sizeBytes, "local");
  for (const file of files) {
    if (file.kind === "ORIGINAL") continue; // mirrors the asset row's bytes
    add(file.sizeBytes, file.storageProvider);
  }
  return { totalBytes, r2Bytes, localBytes };
}

/**
 * Snapshot every project's stored bytes for `day` (idempotent upsert). One
 * row per project per day, so the account bar can sum by owner without R2
 * billing ambiguity. Returns the number of projects recorded.
 */
export async function runStorageMetering(day = new Date().toISOString().slice(0, 10)): Promise<number> {
  const projects = await db
    .select({ id: tandemVideoProjectsTable.id, ownerId: tandemVideoProjectsTable.ownerId })
    .from(tandemVideoProjectsTable);

  let recorded = 0;
  for (const project of projects) {
    try {
      const usage = await projectStorageBytes(project.id);
      await db
        .insert(tandemVideoStorageSnapshotsTable)
        .values({
          projectId: project.id,
          ownerId: project.ownerId,
          day,
          totalBytes: usage.totalBytes,
          r2Bytes: usage.r2Bytes,
          localBytes: usage.localBytes,
        })
        .onConflictDoUpdate({
          target: [tandemVideoStorageSnapshotsTable.projectId, tandemVideoStorageSnapshotsTable.day],
          set: {
            totalBytes: usage.totalBytes,
            r2Bytes: usage.r2Bytes,
            localBytes: usage.localBytes,
          },
        });
      recorded += 1;
    } catch (error) {
      logger.error({ projectId: project.id, err: error }, "Storage metering failed for a project");
    }
  }
  return recorded;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * Drop the LOCAL copy of originals that (a) are older than the retention
 * window, (b) have a ready PROXY (their processing is done), and (c) have a
 * durable R2 ORIGINAL copy — so removing the local file loses nothing. Local
 * originals without an R2 copy are NEVER touched. Returns files reclaimed.
 */
export async function runStorageRetention(): Promise<number> {
  const cutoff = retentionCutoff();
  if (!cutoff) return 0; // retention disabled

  const candidateKeys = await db
    .select({
      id: tandemVideoAssetsTable.id,
      storageKey: tandemVideoAssetsTable.storageKey,
      kind: tandemVideoAssetsTable.kind,
    })
    .from(tandemVideoAssetsTable)
    .where(
      and(
        eq(tandemVideoAssetsTable.storageProvider, "local"),
        lt(tandemVideoAssetsTable.createdAt, cutoff),
      ),
    );

  let reclaimed = 0;
  for (const asset of candidateKeys) {
    if (!existsLocally(asset.storageKey)) continue;
    if (asset.kind === "THUMBNAIL_DESIGN") continue; // bytes ARE the proxy — keep them

    // The local blob may be shared (content-addressed dedupe): never unlink a
    // file that ANOTHER asset row (of any age) still points at — that asset
    // may have no R2 copy of its own yet and would lose its only source.
    const sharers = await db
      .select({ id: tandemVideoAssetsTable.id })
      .from(tandemVideoAssetsTable)
      .where(
        and(
          eq(tandemVideoAssetsTable.storageKey, asset.storageKey),
          eq(tandemVideoAssetsTable.storageProvider, "local"),
        ),
      );
    const shared = sharers.some((row) => row.id !== asset.id);
    if (shared) continue;

    // Durable R2 copy present?
    const [durable] = await db
      .select({ id: tandemVideoAssetFilesTable.id })
      .from(tandemVideoAssetFilesTable)
      .where(
        and(
          eq(tandemVideoAssetFilesTable.assetId, asset.id),
          eq(tandemVideoAssetFilesTable.kind, "ORIGINAL"),
          eq(tandemVideoAssetFilesTable.storageProvider, "r2"),
        ),
      )
      .limit(1);
    if (!durable) continue;

    // Proxy ready (the local original's only remaining job is done)?
    const [proxy] = await db
      .select({ id: tandemVideoAssetFilesTable.id })
      .from(tandemVideoAssetFilesTable)
      .where(
        and(
          eq(tandemVideoAssetFilesTable.assetId, asset.id),
          eq(tandemVideoAssetFilesTable.kind, "PROXY"),
        ),
      )
      .limit(1);
    if (!proxy) continue;

    try {
      fs.unlinkSync(localPathFor(asset.storageKey));
      reclaimed += 1;
      logger.info({ assetId: asset.id }, "Retention: reclaimed local original (R2 copy kept)");
    } catch (error) {
      logger.warn({ assetId: asset.id, err: error }, "Retention unlink failed (best-effort)");
    }
  }
  return reclaimed;
}
