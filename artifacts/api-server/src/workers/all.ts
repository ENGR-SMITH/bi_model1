// Local dev convenience: starts every capability worker in one process.
// Production deployments run the per-capability entrypoints separately
// (blueprint §9 — failure isolation), e.g. via Docker Compose services.
import "../env";
import { logger } from "../lib/logger";
import { createBullMqWorkers, VIDEO_JOB_TYPES } from "../video/queues";
import { runJob } from "../video/worker";

const workers = createBullMqWorkers([...VIDEO_JOB_TYPES], runJob);
logger.info(
  { queues: workers.map((w) => w.name) },
  `all video workers started (${workers.length} queues)`,
);

process.on("SIGINT", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
setInterval(() => {}, 1 << 30);
