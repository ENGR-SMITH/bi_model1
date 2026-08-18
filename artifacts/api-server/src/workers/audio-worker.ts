// Blueprint §9 — `tandem/worker-audio` (FFmpeg · SoX · DeepFilterNet): noise
// reduction, EQ/compression, sidechain ducking, mixing, pickup-VO placement.
// Consumes the AUDIO queue.
import "../env";
import { logger } from "../lib/logger";
import { createBullMqWorkers } from "../video/queues";
import { runJob } from "../video/worker";

const workers = createBullMqWorkers(["AUDIO"], runJob);
logger.info({ queues: workers.map((w) => w.name) }, "audio worker started");

process.on("SIGINT", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
setInterval(() => {}, 1 << 30);
