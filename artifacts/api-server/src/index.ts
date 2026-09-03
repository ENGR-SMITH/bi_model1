import "./env";
import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { initRealtime } from "./realtime";
import { startVideoWorker } from "./video/worker";
import { startStorageMaintenance } from "./video/storage-maintenance-runner";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  // Realtime layer (blueprint §6): Socket.IO on the same HTTP server, with
  // job progress, comments, submissions, notifications, and presence.
  initRealtime(server);
  startVideoWorker();
  startStorageMaintenance();
});
