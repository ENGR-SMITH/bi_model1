import { and, eq, inArray, sum } from "drizzle-orm";
import {
  db,
  tandemAccountQuotasTable,
  tandemVideoAssetFilesTable,
  tandemVideoAssetsTable,
  tandemVideoMembersTable,
  type TandemAccountQuota,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Account quotas — the storage bar (Creator Den) and the project-count bar
// (Author Den). Every account starts free (2 GB of project storage, 5
// projects) and can extend its limit by purchasing a plan. Storage usage is
// the sum of the vault asset bytes across the projects the account owns
// (ACTIVE CAPTAIN), so uploads into a project consume the Captain's quota.
// ---------------------------------------------------------------------------

export const DEFAULT_STORAGE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const DEFAULT_PROJECT_LIMIT = 5;

export interface StoragePlan {
  id: string;
  label: string;
  priceUsd: number;
  bytes: number;
}

export interface ProjectPlan {
  id: string;
  label: string;
  priceUsd: number;
  count: number;
}

// Buy-more storage plans — $20/200GB, $40/500GB, $60/1TB as specified, in USD
// cents (2000/4000/6000) so they share the pass's priceUsd unit and map
// directly onto Paystack's smallest-unit amounts.
export const STORAGE_PLANS: StoragePlan[] = [
  { id: "g200", label: "200 GB", priceUsd: 2000, bytes: 200 * 1024 ** 3 },
  { id: "g500", label: "500 GB", priceUsd: 4000, bytes: 500 * 1024 ** 3 },
  { id: "tb1", label: "1 TB", priceUsd: 6000, bytes: 1024 ** 4 },
];

// Buy-more project plans — $5/10, $20/50, $50/200 as specified, in USD cents
// (500/2000/5000) — same unit as every other plan price.
export const PROJECT_PLANS: ProjectPlan[] = [
  { id: "p10", label: "10 more projects", priceUsd: 500, count: 10 },
  { id: "p50", label: "50 more projects", priceUsd: 2000, count: 50 },
  { id: "p200", label: "200 more projects", priceUsd: 5000, count: 200 },
];

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Returns the account's quota row, creating the free default on first use. */
export async function getOrCreateQuota(userId: string): Promise<TandemAccountQuota> {
  const [existing] = await db
    .select()
    .from(tandemAccountQuotasTable)
    .where(eq(tandemAccountQuotasTable.userId, userId))
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(tandemAccountQuotasTable)
    .values({
      userId,
      storageLimitBytes: DEFAULT_STORAGE_LIMIT_BYTES,
      projectLimit: DEFAULT_PROJECT_LIMIT,
    })
    .returning();
  return row;
}

/** Ids of the projects this account owns (ACTIVE CAPTAIN membership). */
export async function ownedProjectIds(userId: string): Promise<string[]> {
  const members = await db
    .select()
    .from(tandemVideoMembersTable)
    .where(
      and(
        eq(tandemVideoMembersTable.userId, userId),
        eq(tandemVideoMembersTable.status, "ACTIVE"),
      ),
    );
  return members
    .filter((member) => (member.roles ?? []).includes("CAPTAIN"))
    .map((member) => member.projectId);
}

/**
 * The account's ACTUAL stored bytes across its projects, computed LIVE from
 * the database on every call: every original (asset rows) plus every derived
 * artifact (asset_files rows — proxies, renders, exports, thumbnails, stems,
 * bundles). ORIGINAL-kind file rows mirror the asset's own durable copy and
 * are not double-counted.
 *
 * Deliberately NOT the nightly snapshot: this number feeds the upload gate
 * and the profile bar, and a snapshot is up to 24h stale — a user could keep
 * uploading past their quota all day until the next run recorded it. The
 * storage snapshots table remains the nightly billing/history ledger; live
 * enforcement reads the truth.
 */
export async function storageUsedBytes(projectIds: string[]): Promise<number> {
  if (projectIds.length === 0) return 0;

  // Live: sum the originals (asset rows) plus every derived artifact
  // (asset_files rows) that belongs to one of the projects. ORIGINAL-kind
  // rows mirror the asset's own durable copy — excluded to avoid double count.
  const [assetsRow] = await db
    .select({ total: sum(tandemVideoAssetsTable.sizeBytes) })
    .from(tandemVideoAssetsTable)
    .where(inArray(tandemVideoAssetsTable.projectId, projectIds));
  const originals = Number(assetsRow?.total ?? 0);

  const fileRows = await db
    .select({ sizeBytes: tandemVideoAssetFilesTable.sizeBytes, kind: tandemVideoAssetFilesTable.kind })
    .from(tandemVideoAssetFilesTable)
    .where(
      inArray(
        tandemVideoAssetFilesTable.assetId,
        db
          .select({ id: tandemVideoAssetsTable.id })
          .from(tandemVideoAssetsTable)
          .where(inArray(tandemVideoAssetsTable.projectId, projectIds)),
      ),
    );
  const derived = fileRows
    .filter((file) => file.kind !== "ORIGINAL")
    .reduce((acc, file) => acc + (file.sizeBytes || 0), 0);
  return originals + derived;
}

export interface AccountUsage {
  storageBytes: { usedBytes: number; totalBytes: number; remainingBytes: number };
  projects: { used: number; total: number; remaining: number };
}

/** Current usage + limits for an account (used by the profile bars). */
export async function accountUsage(userId: string): Promise<AccountUsage> {
  const quota = await getOrCreateQuota(userId);
  const owned = await ownedProjectIds(userId);
  const usedBytes = await storageUsedBytes(owned);
  return {
    storageBytes: {
      usedBytes,
      totalBytes: quota.storageLimitBytes,
      remainingBytes: Math.max(0, quota.storageLimitBytes - usedBytes),
    },
    projects: {
      used: owned.length,
      total: quota.projectLimit,
      remaining: Math.max(0, quota.projectLimit - owned.length),
    },
  };
}

/**
 * Upload gate: before landing `sizeBytes` into a project, verify the owning
 * Captain's account still has room. Rejects when the file would exceed the
 * remaining quota — this is what actually enforces the 2 GB default until a
 * buy-more plan raises the limit.
 */
export async function ensureUploadFits(
  projectId: string,
  sizeBytes: number,
): Promise<{ ok: true; remainingBytes: number } | { ok: false; remainingBytes: number; error: string }> {
  const members = await db
    .select()
    .from(tandemVideoMembersTable)
    .where(
      and(
        eq(tandemVideoMembersTable.projectId, projectId),
        eq(tandemVideoMembersTable.status, "ACTIVE"),
      ),
    );
  const owner = members.find((member) => (member.roles ?? []).includes("CAPTAIN"));
  // No CAPTAIN row (shouldn't happen — projects are created with one) → don't
  // block the upload.
  if (!owner) return { ok: true, remainingBytes: 0 };

  const usage = await accountUsage(owner.userId);
  const remainingBytes = usage.storageBytes.remainingBytes;
  if (sizeBytes > remainingBytes) {
    return {
      ok: false,
      remainingBytes,
      error: `Storage limit reached — ${formatBytes(remainingBytes)} left on this account. Buy more space to keep uploading.`,
    };
  }
  return { ok: true, remainingBytes };
}
