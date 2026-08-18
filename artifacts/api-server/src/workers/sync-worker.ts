// Blueprint §9 — `tandem/worker-sync` (FFmpeg): waveform multi-cam / dual-system
// audio sync → offset metadata + synced AssetFile. Consumes the SYNC queue.
import "../env";
import { logger } from "../lib/logger";
import { createBullMqWorkers } from "../video/queues";
import { runJob } from "../video/worker";

const workers = createBullMqWorkers(["SYNC"], runJob);
logger.info({ queues: workers.map((w) => w.name) }, "sync worker started");

process.on("SIGINT", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
setInterval(() => {}, 1 << 30);
