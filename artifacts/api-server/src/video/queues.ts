// ---------------------------------------------------------------------------
// BullMQ + Redis worker fleet (blueprint §6 / §9).
//
// The Postgres `tandem_video_jobs` row stays the source of truth for job state
// (the API reads it for GET /jobs); BullMQ becomes the claim/dispatch layer
// with retries, backoff, and progress events — exactly what the worker comment
// promised: "BullMQ/Redis simply becomes the claim layer and the processors
// below move into the worker image unchanged."
//
//   - One queue per job type (blueprint rule 1: one job type → one queue →
//     one worker image). Queue names: `tandem-video-<type>`.
//   - Enqueue (API process): insert the row, then `add()` with `jobId` = the
//     row id, so BullMQ jobs map 1:1 to DB rows and retries re-claim the same
//     row (idempotent — outputs are written as new AssetFile rows).
//   - Workers (separate processes): consume their capability's queue(s), fetch
//     the row, publish progress through Redis (`job.updateProgress`), and run
//     the shared processor. Results land in the shared Postgres via the
//     workspace DB package; the API's QueueEvents bridge forwards progress to
//     the Socket.IO project room ("progress to the queue → API → WebSocket").
//   - No Redis configured (local dev without Redis / isolated route tests):
//     BullMQ is never touched — the in-process polling loop in worker.ts runs
//     instead. Nothing in this module connects at import time.
// ---------------------------------------------------------------------------

import { Queue, QueueEvents, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import {
  db,
  tandemVideoJobsTable,
  type TandemVideoJob,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { emitToProject } from "../realtime";
import {
  bullmqEnabled,
  queueNameFor,
  VIDEO_JOB_TYPES,
  type VideoJobType,
} from "./queue-config";

export {
  bullmqEnabled,
  queueNameFor,
  VIDEO_JOB_TYPES,
  type VideoJobType,
};

function connection(): IORedis {
  // maxRetriesPerRequest: null is required by BullMQ (jobs may wait a long
  // time; a request must never be dropped because Redis is momentarily busy).
  return new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
}

// Per-job-type queues, created lazily so imports never touch Redis.
const queues = new Map<string, Queue>();

function getQueue(jobType: string): Queue {
  let queue = queues.get(jobType);
  if (!queue) {
    queue = new Queue(queueNameFor(jobType), { connection: connection() });
    queues.set(jobType, queue);
  }
  return queue;
}

/**
 * Pushes an already-inserted job row onto its queue. No-op without Redis, so
 * the polling fallback (and isolated route tests) are unaffected.
 */
export async function enqueueBullMqJob(job: {
  id: string;
  projectId: string;
  type: string;
}): Promise<void> {
  if (!bullmqEnabled()) return;
  await getQueue(job.type).add(
    job.type,
    { projectId: job.projectId },
    {
      jobId: job.id, // 1:1 with the DB row; retries re-claim the same row
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  );
  logger.info({ jobId: job.id, type: job.type }, "Job pushed to BullMQ");
}

/**
 * Attaches QueueEvents listeners (API process) that forward worker progress
 * from Redis to the project's Socket.IO room. No-op without Redis.
 */
export function attachQueueEventBridge(): void {
  if (!bullmqEnabled()) return;
  for (const type of VIDEO_JOB_TYPES) {
    const events = new QueueEvents(queueNameFor(type), {
      connection: connection(),
    });
    events.on("progress", ({ jobId, data }) => {
      const payload = (data ?? {}) as {
        projectId?: string;
        jobId?: string;
        type?: string;
        status?: string;
        error?: string | null;
      };
      if (!payload.projectId) return;
      emitToProject(payload.projectId, "job.progress", {
        projectId: payload.projectId,
        jobId: payload.jobId ?? jobId,
        type: payload.type ?? type,
        status: payload.status ?? "RUNNING",
        error: payload.error ?? null,
      });
    });
    events.on("failed", ({ jobId, failedReason }) => {
      logger.warn({ jobId, type, failedReason }, "BullMQ job failed");
    });
  }
  logger.info(
    { queues: VIDEO_JOB_TYPES.map(queueNameFor) },
    "BullMQ progress bridge attached",
  );
}

export type JobProcessor = (job: TandemVideoJob) => Promise<void>;

/**
 * Creates a BullMQ Worker per queue. Each worker claims the DB row by id,
 * publishes state through Redis (the API's QueueEvents bridge streams it to
 * the project room), runs the shared processor, and lets BullMQ retry with
 * backoff on failure. Returns the created workers.
 */
export function createBullMqWorkers(
  jobTypes: VideoJobType[],
  processor: JobProcessor,
): Worker[] {
  return jobTypes.map((type) => {
    const worker = new Worker(
      queueNameFor(type),
      async (bullJob: Job<unknown>) => {
        const [row] = await db
          .select()
          .from(tandemVideoJobsTable)
          .where(eq(tandemVideoJobsTable.id, bullJob.id as string))
          .limit(1);
        if (!row) {
          throw new Error(`Job row ${String(bullJob.id)} no longer exists`);
        }

        await bullJob.updateProgress({
          projectId: row.projectId,
          jobId: row.id,
          type: row.type,
          status: "RUNNING",
        });

        try {
          await processor(row);
          await bullJob.updateProgress({
            projectId: row.projectId,
            jobId: row.id,
            type: row.type,
            status: "SUCCEEDED",
          });
          return { ok: true };
        } catch (error) {
          const message = (error as Error).message;
          await bullJob.updateProgress({
            projectId: row.projectId,
            jobId: row.id,
            type: row.type,
            status: "FAILED",
            error: message,
          });
          throw error; // BullMQ retries with exponential backoff
        }
      },
      { connection: connection(), concurrency: 1 },
    );

    worker.on("failed", (job, err) => {
      logger.error(
        { jobId: job?.id, type, err: err.message },
        "Worker job failed after retries",
      );
    });

    return worker;
  });
}
