// ---------------------------------------------------------------------------
// Stuck-proxy recovery.
//
// The PROXY job is what turns an upload into something a browser can play; the
// vault shows "Building the proxy…" until it succeeds. Two failure modes leave
// an asset stuck at UPLOADED forever, with nothing to bring it back:
//
//   - The job failed. BullMQ retries three times, but the in-process polling
//     fallback claims QUEUED rows only — a FAILED row is never picked up
//     again, so a single transient failure (a full disk, an ffmpeg hiccup, a
//     source file wiped by a redeploy before its R2 copy could be read) parks
//     the asset permanently.
//   - The process died mid-encode (a deploy/restart). The row stays RUNNING
//     with no owner alive to finish it, and nothing ever claims it.
//
// Two triggers close that hole:
//
//   1. on demand — the vault polls the project detail route every 3 s while
//      anything is still processing, so a stuck asset is handed back to the
//      queue as soon as somebody is looking at it;
//   2. a periodic sweep (proxy-recovery-runner.ts) for assets nobody opens.
//
// Both are bounded and idempotent: an asset never accumulates more than
// PROXY_MAX_ATTEMPTS PROXY jobs, a live job is never duplicated, and a source
// that is genuinely gone (no local file and no durable R2 copy) is reported
// instead of queued to fail forever.
// ---------------------------------------------------------------------------

import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import {
  db,
  nexetVideoAssetFilesTable,
  nexetVideoAssetsTable,
  nexetVideoJobsTable,
  type NexetVideoAsset,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ensureOriginalRestored } from "./object-storage";
import { bullmqEnabled } from "./queues";
import { isJobInFlight, requeueProxyJob } from "./worker";

/**
 * Total PROXY jobs (the original one plus every recovery) an asset may
 * accumulate before recovery stops trying. A source that cannot be built must
 * not spin the queue forever — after this it is reported for a re-upload.
 */
export const PROXY_MAX_ATTEMPTS = 3;

/** How long a RUNNING PROXY job may sit with no live owner before it counts
 * as interrupted (see `isJobInFlight`). Generous on purpose: a long encode on
 * a slow box is still work in progress, not a corpse. */
const STALE_RUNNING_DEFAULT_MINUTES = 30;

/** Assets younger than this are never touched — the upload request that
 * created them is still enqueueing its first jobs. */
const MIN_ASSET_AGE_MS = 2 * 60 * 1000;

/** A job QUEUED this long in BullMQ mode means the queues have no consumer. */
const QUEUE_STALL_WARNING_MS = 5 * 60 * 1000;

function staleRunningMs(): number {
  const raw = process.env.PROXY_STALE_RUNNING_MINUTES?.trim();
  const minutes = raw ? Number(raw) : NaN;
  const effective = Number.isFinite(minutes) && minutes >= 1 ? minutes : STALE_RUNNING_DEFAULT_MINUTES;
  return effective * 60 * 1000;
}

// One report per asset per process: the sweep runs on a timer, and an asset
// nobody can heal must not flood the log every cycle.
const reportedAssetIds = new Set<string>();

function reportOnce(assetId: string, message: string, fields: Record<string, unknown>): void {
  if (reportedAssetIds.has(assetId)) return;
  reportedAssetIds.add(assetId);
  logger.warn({ assetId, ...fields }, message);
}

/** Statuses that already have an owner: PROCESSED is done, PENDING_REVIEW is
 * held for the Captain and never gets a proxy until it is approved. */
function isEligible(asset: NexetVideoAsset): boolean {
  if (asset.status === "PROCESSED" || asset.status === "PENDING_REVIEW") return false;
  // A designed thumbnail's bytes ARE its preview — no ffmpeg pass is owed.
  if (asset.kind === "THUMBNAIL_DESIGN") return false;
  if (Date.now() - new Date(asset.createdAt).getTime() < MIN_ASSET_AGE_MS) return false;
  return true;
}

async function recover(asset: NexetVideoAsset): Promise<string | null> {
  if (!isEligible(asset)) return null;

  const jobs = await db
    .select({
      id: nexetVideoJobsTable.id,
      status: nexetVideoJobsTable.status,
      error: nexetVideoJobsTable.error,
      startedAt: nexetVideoJobsTable.startedAt,
      createdAt: nexetVideoJobsTable.createdAt,
    })
    .from(nexetVideoJobsTable)
    .where(
      and(
        eq(nexetVideoJobsTable.assetId, asset.id),
        eq(nexetVideoJobsTable.type, "PROXY"),
      ),
    );

  // A queued job is already claimed work — never duplicate it.
  if (jobs.some((job) => job.status === "QUEUED")) return null;

  const running = jobs.filter((job) => job.status === "RUNNING");
  if (running.length > 0) {
    // In BullMQ mode a RUNNING row almost certainly belongs to a separate
    // worker process, and BullMQ's own stalled-job handling re-claims the ones
    // whose worker died — so this process has no business touching them.
    if (bullmqEnabled()) return null;
    // Otherwise the in-process poller is the job runner, and a RUNNING row
    // this process is not executing can only be a leftover from a process that
    // died mid-job. The grace period (PROXY_STALE_RUNNING_MINUTES, 30 min by
    // default) is what keeps that judgement safe: it is far longer than any
    // healthy claim-to-finish gap, and it also protects the unsupported
    // multi-instance polling setup, where a second API process would otherwise
    // re-claim a long encode that is still running in the first.
    if (running.some((job) => isJobInFlight(job.id))) return null;
    const newest = running.reduce((latest, job) => {
      const at = new Date(job.startedAt ?? job.createdAt).getTime();
      return at > latest ? at : latest;
    }, 0);
    if (Date.now() - newest < staleRunningMs()) return null;

    await db
      .update(nexetVideoJobsTable)
      .set({
        status: "FAILED",
        error: "Interrupted before it finished (the server stopped mid-job)",
        finishedAt: new Date(),
      })
      .where(inArray(
        nexetVideoJobsTable.id,
        running.map((job) => job.id),
      ));
    logger.warn(
      { assetId: asset.id, projectId: asset.projectId, jobIds: running.map((job) => job.id) },
      "Reclaimed a PROXY job left RUNNING by a server that stopped mid-job",
    );
  }

  // A PROXY file row means something already owns the proxy: the server job
  // finished it, or the desktop agent is mid-upload through
  // proxy-upload-url / proxy-ready. Recovery must not fight either one — a
  // failed agent upload is re-run from the agent, not re-encoded here.
  const [proxyFile] = await db
    .select({ id: nexetVideoAssetFilesTable.id })
    .from(nexetVideoAssetFilesTable)
    .where(
      and(
        eq(nexetVideoAssetFilesTable.assetId, asset.id),
        eq(nexetVideoAssetFilesTable.kind, "PROXY"),
      ),
    )
    .limit(1);
  if (proxyFile) return null;

  if (jobs.length >= PROXY_MAX_ATTEMPTS) {
    const lastError = jobs.filter((job) => job.status === "FAILED").at(-1)?.error ?? null;
    reportOnce(
      asset.id,
      "Proxy recovery gave up after repeated failures — re-upload this file to rebuild its preview",
      { projectId: asset.projectId, attempts: jobs.length, lastError },
    );
    return null;
  }

  // Every processor reads the original from the local processing disk, which
  // an ephemeral container loses on restart. Restore the durable R2 copy first
  // (exactly what runJob does) so an unrecoverable source is reported instead
  // of being queued only to fail again.
  if (!(await ensureOriginalRestored(asset))) {
    reportOnce(
      asset.id,
      "Proxy recovery skipped: the uploaded source is gone from disk and no durable copy exists — re-upload this file",
      { projectId: asset.projectId, storageKey: asset.storageKey },
    );
    return null;
  }

  const jobId = await requeueProxyJob(asset.projectId, asset.id);
  logger.info(
    { assetId: asset.id, projectId: asset.projectId, jobId, attempt: jobs.length + 1 },
    "Re-queued a stuck PROXY job",
  );
  return jobId;
}

/**
 * Hands one stuck asset's PROXY job back to the queue. Returns the new job id,
 * or null when the asset needs no help. Never throws — recovery is a read-path
 * side effect (the vault's poll), so a failure must not break the request.
 */
export async function recoverStuckProxy(asset: NexetVideoAsset): Promise<string | null> {
  try {
    return await recover(asset);
  } catch (error) {
    logger.error({ assetId: asset.id, err: error }, "Stuck-proxy recovery failed");
    return null;
  }
}

/**
 * Recovery for the assets a request just loaded (the vault's poll path).
 * Sequential on purpose: the batch is small, and one R2 restore at a time is
 * plenty.
 */
export async function recoverStuckProxies(assets: ReadonlyArray<NexetVideoAsset>): Promise<void> {
  for (const asset of assets) {
    if (!isEligible(asset)) continue;
    await recoverStuckProxy(asset);
  }
}

/**
 * BullMQ mode with nothing consuming the queues looks exactly like a slow
 * proxy build: the API stops processing jobs itself, the rows sit QUEUED, and
 * assets never leave UPLOADED. Recovery deliberately never touches queued work
 * (that job is claimed, not dead), so say out loud what the fix is instead of
 * letting the vault spin forever in silence. Logged once per cycle.
 */
async function warnIfQueuesUnconsumed(): Promise<void> {
  if (!bullmqEnabled()) return;
  const [stale] = await db
    .select({ id: nexetVideoJobsTable.id })
    .from(nexetVideoJobsTable)
    .where(
      and(
        eq(nexetVideoJobsTable.status, "QUEUED"),
        lt(nexetVideoJobsTable.createdAt, new Date(Date.now() - QUEUE_STALL_WARNING_MS)),
      ),
    )
    .limit(1);
  if (!stale) return;
  logger.warn(
    { jobId: stale.id },
    "Video jobs have been QUEUED for over 5 minutes while REDIS_URL is set — nothing is consuming the queues, so uploads stay at 'Building the proxy…'. Run the worker fleet (`pnpm --filter @workspace/api-server run workers`, or the Background Worker service the deploy guide describes), or unset REDIS_URL so the API processes jobs in-process.",
  );
}

/**
 * The periodic sweep: give every stuck asset one more chance. Bounded per
 * cycle so a large backlog heals steadily instead of in one thundering herd,
 * and oldest-first so the longest-suffering file is fixed first.
 */
export async function recoverStuckProxyJobs(
  opts: { limit?: number } = {},
): Promise<{ scanned: number; requeued: number }> {
  await warnIfQueuesUnconsumed();
  const limit = opts.limit ?? 50;
  const candidates = await db
    .select()
    .from(nexetVideoAssetsTable)
    .where(
      and(
        ne(nexetVideoAssetsTable.status, "PROCESSED"),
        ne(nexetVideoAssetsTable.status, "PENDING_REVIEW"),
        ne(nexetVideoAssetsTable.kind, "THUMBNAIL_DESIGN"),
        lt(nexetVideoAssetsTable.createdAt, new Date(Date.now() - MIN_ASSET_AGE_MS)),
      ),
    )
    .orderBy(asc(nexetVideoAssetsTable.createdAt))
    .limit(limit);

  let requeued = 0;
  for (const asset of candidates) {
    if (await recoverStuckProxy(asset)) requeued += 1;
  }
  return { scanned: candidates.length, requeued };
}
