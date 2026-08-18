// Blueprint §9 — `tandem/worker-render` (melt/MLT + FFmpeg): timeline JSON →
// rendered preview / rough cut / picture-lock. Consumes the RENDER queue.
import "../env";
import { logger } from "../lib/logger";
import { createBullMqWorkers } from "../video/queues";
import { runJob } from "../video/worker";

const workers = createBullMqWorkers(["RENDER"], runJob);
logger.info({ queues: workers.map((w) => w.name) }, "render worker started");

process.on("SIGINT", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
setInterval(() => {}, 1 << 30);
