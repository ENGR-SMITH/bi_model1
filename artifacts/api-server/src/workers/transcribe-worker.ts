// Blueprint §9 — `tandem/worker-transcribe` (faster-whisper): auto-transcription
// of all dialogue → JSON + SRT. Consumes the TRANSCRIBE queue.
import "../env";
import { logger } from "../lib/logger";
import { createBullMqWorkers } from "../video/queues";
import { runJob } from "../video/worker";

const workers = createBullMqWorkers(["TRANSCRIBE"], runJob);
logger.info({ queues: workers.map((w) => w.name) }, "transcribe worker started");

process.on("SIGINT", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void Promise.all(workers.map((w) => w.close())).then(() => process.exit(0));
});
setInterval(() => {}, 1 << 30);
