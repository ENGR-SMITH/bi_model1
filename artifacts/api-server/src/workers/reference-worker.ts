// Blueprint §9 — reference import: transcribe + pacing extraction (FFmpeg scene
// change detection) → ReferenceImport.pacingJson for the Architect's side-by-side
// guide. Consumes the REFERENCE_ANALYZE queue.
import "../env";
import { logger } from "../lib/logger";
import { createBullMqWorkers } from "../video/queues";
import { runJob } from "../video/worker";

const workers = createBullMqWorkers(["REFERENCE_ANALYZE"], runJob);
logger.info({ queues: workers.map((w) => w.name) }, "reference worker started");

process.on("SIGINT", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
setInterval(() => {}, 1 << 30);
