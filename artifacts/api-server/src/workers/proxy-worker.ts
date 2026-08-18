// Blueprint §9 — `tandem/worker-proxy` (FFmpeg): low-res proxies, frame
// extraction, format normalization. Consumes the PROXY queue.
import "../env";
import { logger } from "../lib/logger";
import { createBullMqWorkers } from "../video/queues";
import { runJob } from "../video/worker";

const workers = createBullMqWorkers(["PROXY"], runJob);
logger.info({ queues: workers.map((w) => w.name) }, "proxy worker started");

process.on("SIGINT", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
// Keep the process alive even if Redis drops momentarily.
setInterval(() => {}, 1 << 30);
