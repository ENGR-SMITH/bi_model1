// Loopback control server — the channel Creator Den uses to reach a *running*
// agent (same pattern as the sign-in token receiver in auth.ts, but persistent
// instead of per-attempt):
//
//   GET  /health      → { ok: true, version, signedIn }   ("is the agent up?")
//   POST /launch      → hand over { projectId, returnUrl } + focus the app
//   GET  /job-status  → the most recent upload job, so the web page knows when
//                       the upload finished and it can refresh / redirect back
//
// The server binds 127.0.0.1 only. CORS is locked to the web app's origin and
// Access-Control-Allow-Private-Network is set so Chrome/Firefox let a public
// HTTPS page reach the loopback address (Private Network Access).
import http from "node:http";
import type { AgentJobStatus, LaunchContext } from "../shared/types";

export { isAllowedReturnUrl };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** The most recent web-initiated hand-off (which page to reopen on success). */
let launchContext: LaunchContext = {};

export function markLaunchContext(ctx: LaunchContext): void {
  launchContext = { ...ctx };
}

export function getLaunchContext(): LaunchContext {
  return launchContext;
}

/** The agent's most recent upload job, reported to the web page via /job-status. */
let job: AgentJobStatus = { running: false, done: false };

export function markJobStart(partial: { projectId: string; fileName: string; returnUrl?: string }): void {
  job = { running: true, done: false, projectId: partial.projectId, fileName: partial.fileName, returnUrl: partial.returnUrl };
}

export function markJobDone(error?: string): void {
  job = { ...job, running: false, done: true, error };
}

export function getJobStatus(): AgentJobStatus {
  return job;
}

/** A return URL is only ever followed when it points back at the web app's
 * own origin — never an arbitrary link (no open-redirect via the agent). */
function isAllowedReturnUrl(raw: string | undefined, webAppUrl: string): boolean {
  if (!raw) return false;
  try {
    const target = new URL(raw);
    const origin = new URL(webAppUrl).origin;
    return target.origin === origin && (target.protocol === "https:" || target.protocol === "http:");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface ControlServerOptions {
  /** Origin the web app runs on — the only origin CORS allows + return URLs may point at. */
  webAppUrl: string;
  /** Loopback port to bind (127.0.0.1 only). */
  port: number;
  getVersion: () => string;
  isSignedIn: () => boolean;
  /** Fired when Creator Den POSTs /launch — focus the window, preselect the project. */
  onLaunch: (ctx: LaunchContext) => void;
}

export function startControlServer(opts: ControlServerOptions): http.Server | null {
  const corsOrigin = new URL(opts.webAppUrl).origin;
  const corsHeaders = {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };

  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    const path = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          version: opts.getVersion(),
          signedIn: opts.isSignedIn(),
        }),
      );
      return;
    }

    if (req.method === "POST" && path === "/launch") {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk;
        if (body.length > 64 * 1024) req.destroy();
      });
      req.on("end", () => {
        let parsed: Partial<LaunchContext> = {};
        try {
          parsed = JSON.parse(body) as Partial<LaunchContext>;
        } catch {
          res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Invalid request body." }));
          return;
        }
        const ctx: LaunchContext = {
          projectId: typeof parsed.projectId === "string" && parsed.projectId ? parsed.projectId : undefined,
          returnUrl:
            typeof parsed.returnUrl === "string" && isAllowedReturnUrl(parsed.returnUrl, opts.webAppUrl)
              ? parsed.returnUrl
              : undefined,
        };
        markLaunchContext(ctx);
        opts.onLaunch(ctx);
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (req.method === "GET" && path === "/job-status") {
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify(getJobStatus()));
      return;
    }

    res.writeHead(404, corsHeaders);
    res.end();
  });

  // A second app already owning the port (or a stale instance) must not crash
  // the agent — the deep link still launches it; only the polling degrades.
  server.on("error", (err) => {
    console.error("[agent] control server failed to start:", err.message);
  });

  try {
    server.listen(opts.port, "127.0.0.1");
  } catch (err) {
    console.error("[agent] control server listen error:", (err as Error).message);
    return null;
  }
  return server;
}