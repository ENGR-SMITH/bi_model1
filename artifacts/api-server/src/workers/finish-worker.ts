// Blueprint §9 — `tandem/worker-finish` (Blender · FFmpeg · ImageMagick):
// multi-format exports (16:9 / 9:16 / 1:1) and thumbnail extraction + polish.
// Consumes the EXPORT and THUMBNAIL queues.
import "../env";
import { logger } from "../lib/logger";
import { createBullMqWorkers } from "../video/queues";
import { runJob } from "../video/worker";

const workers = createBullMqWorkers(["EXPORT", "THUMBNAIL"], runJob);
logger.info({ queues: workers.map((w) => w.name) }, "finish worker started");

process.on("SIGINT", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
setInterval(() => {}, 1 << 30);
