// ---------------------------------------------------------------------------
// Physical-file cleanup for vault deletes.
//
// Deleting a project/asset row must also reclaim its storage or the bill grows
// forever (R2 objects orphaned by a project delete, local originals left on
// ephemeral disk). Cleanup respects content addressing:
//   - Local originals are deduped — one flat blob under the upload dir can
//     back several assets, possibly across projects. A local file is only
//     unlinked when no REMAINING row still references its key.
//   - R2 objects are project-scoped (`projects/{projectId}/...`) and always
//     per-asset/per-job. A single deleted asset drops its own keys; a deleted
//     project wipes its whole prefix.
// ---------------------------------------------------------------------------

import {
  db,
  tandemVideoAssetFilesTable,
  tandemVideoAssetsTable,
} from "@workspace/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import fs from "node:fs";
import { logger } from "../lib/logger";
import { getStore, localPathFor } from "./object-storage";

/** Everything a vault deletion will orphan: physical keys + the row ids. */
export async function captureVaultStorage(projectId: string, assetId?: string): Promise<{
  keys: string[];
  assetIds: string[];
  fileIds: string[];
  /** Keys whose rows are R2-hosted (the only ones that exist in R2). */
  fileR2Keys: string[];
}> {
  const [assets, files] = await Promise.all([
    db
      .select({ id: tandemVideoAssetsTable.id, storageKey: tandemVideoAssetsTable.storageKey })    .from(tandemVideoAssetsTable)
    .where(assetId ? and(eq(tandemVideoAssetsTable.projectId, projectId), eq(tandemVideoAssetsTable.id, assetId)) : eq(tandemVideoAssetsTable.projectId, projectId)),
    db
      .select({
        id: tandemVideoAssetFilesTable.id,
        storageKey: tandemVideoAssetFilesTable.storageKey,
        storageProvider: tandemVideoAssetFilesTable.storageProvider,
      })
      .from(tandemVideoAssetFilesTable)
      .where(
        assetId
          ? eq(tandemVideoAssetFilesTable.assetId, assetId)
          : and(
              isNotNull(tandemVideoAssetFilesTable.assetId),
              inArray(
                tandemVideoAssetFilesTable.assetId,
                db
                  .select({ id: tandemVideoAssetsTable.id })
                  .from(tandemVideoAssetsTable)
                  .where(eq(tandemVideoAssetsTable.projectId, projectId)),
              ),
            ),
      ),
  ]);
  return {
    keys: [...new Set([...assets.map((a) => a.storageKey), ...files.map((f) => f.storageKey)])],
    assetIds: assets.map((a) => a.id),
    fileIds: files.map((f) => f.id),
    fileR2Keys: [...new Set(files.filter((f) => f.storageProvider === "r2").map((f) => f.storageKey))],
  };
}

/**
 * Keys among `candidates` that no surviving row (outside the deleted set)
 * references. Content-addressed blobs are shared across assets and projects
 * (deduped originals AND reused proxies), so both the local file and its R2
 * object must survive as long as another row points at the key.
 */
async function orphanedKeys(params: {
  candidates: string[];
  deletedAssetIds: string[];
  deletedFileIds: string[];
}): Promise<Set<string>> {
  if (params.candidates.length === 0) return new Set();
  const deletedAssets = new Set(params.deletedAssetIds);
  const deletedFiles = new Set(params.deletedFileIds);
  const survivorKeys = new Set<string>();

  const [assets, files] = await Promise.all([
    db
      .select({ id: tandemVideoAssetsTable.id, storageKey: tandemVideoAssetsTable.storageKey })
      .from(tandemVideoAssetsTable)
      .where(inArray(tandemVideoAssetsTable.storageKey, params.candidates)),
    db
      .select({ id: tandemVideoAssetFilesTable.id, storageKey: tandemVideoAssetFilesTable.storageKey })
      .from(tandemVideoAssetFilesTable)
      .where(inArray(tandemVideoAssetFilesTable.storageKey, params.candidates)),
  ]);
  for (const row of assets) {
    if (!deletedAssets.has(row.id)) survivorKeys.add(row.storageKey);
  }
  for (const row of files) {
    if (!deletedFiles.has(row.id)) survivorKeys.add(row.storageKey);
  }

  const orphans = new Set<string>();
  for (const key of params.candidates) {
    if (!survivorKeys.has(key)) orphans.add(key);
  }
  return orphans;
}

/**
 * Reclaim physical storage AFTER the vault rows were deleted. Local blobs
 * still referenced by any remaining row (in any project) are kept — that is
 * what lets content-addressed originals be shared safely. Best-effort: a
 * failed reclaim must never block or fail the delete itself.
 */
export async function reclaimDeletedVaultFiles(params: {
  projectId: string;
  /** Physical keys of the deleted rows (captured before the delete). */
  keys: string[];
  assetIds: string[];
  fileIds: string[];
  /** R2 keys owned by the deleted rows (rows already gone; keys captured). */
  fileR2Keys: string[];
  /** True when the whole project is deleted → wipe the R2 prefix. False for
   * a single-asset delete → remove only that asset's own R2 keys. */
  wholeProject: boolean;
}): Promise<{ localFilesRemoved: number; r2ObjectsRemoved: number }> {
  // Decide which keys are genuinely orphaned BEFORE deleting anything — the
  // survivor check must see all rows that still exist.
  const orphans = await orphanedKeys({
    candidates: params.keys,
    deletedAssetIds: params.assetIds,
    deletedFileIds: params.fileIds,
  });

  let r2ObjectsRemoved = 0;
  try {
    if (params.wholeProject) {
      r2ObjectsRemoved = await getStore().deleteProject(params.projectId);
    } else {
      const r2Orphans = [...orphans].filter((key) => params.fileR2Keys.includes(key));
      r2ObjectsRemoved = await getStore().deleteKeys(params.projectId, r2Orphans);
    }
  } catch (error) {
    logger.warn({ projectId: params.projectId, err: error }, "R2 cleanup failed (best-effort)");
  }

  let localFilesRemoved = 0;
  for (const storageKey of orphans) {
    const localPath = localPathFor(storageKey);
    if (!fs.existsSync(localPath)) continue;
    try {
      fs.unlinkSync(localPath);
      localFilesRemoved += 1;
    } catch (error) {
      logger.warn({ storageKey, err: error }, "Local file unlink failed (best-effort)");
    }
  }
  return { localFilesRemoved, r2ObjectsRemoved };
}
