import express, { type Express } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
if (process.env.CLERK_SECRET_KEY) {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}
// Paystack signs webhook bodies with HMAC-SHA512 over the raw bytes, so the
// JSON parser stashes the exact request buffer on the request (req.rawBody)
// while still populating req.body for every other route.
app.use(express.json({ verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// Desktop-agent release feed (latest.yml + installer + blockmap). Only
// mounted when the agent has been built on this machine (electron-builder
// writes to ../desktop-agent/dist-bundle), so a locally installed agent can
// update from this API server — e.g. through a devtunnel to port 3000 while
// testing. Skipped entirely when the folder isn't there (CI / prod hosts).
const agentDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../desktop-agent/dist-bundle");
if (fs.existsSync(agentDist)) {
  app.use(
    "/desktop-agent",
    express.static(agentDist, {
      index: false,
      dotfiles: "ignore",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".yml")) res.setHeader("Content-Type", "text/yaml; charset=utf-8");
      },
    }),
  );
}

app.use("/api", router);

export default app;
