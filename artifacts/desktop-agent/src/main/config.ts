// Configuration for the desktop agent. Values come from, in order of priority:
//  1. process.env
//  2. a JSON config file adjacent to the app (config.json / ~/.nexet-agent.json)
//  3. in-code defaults
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AgentConfig {
  /** Base URL of the Nexet API server, no trailing slash. */
  apiBaseUrl: string;
  /**
   * Public origin of the Nexet web app (creators-den), no trailing slash.
   * The sign-in link points at its hosted /agent-signin page — Clerk only
   * initialises on origins registered for the instance, so the page must run
   * on the web app's domain rather than on a loopback server.
   */
  webAppUrl: string;
  /** Clerk publishable key for the browser sign-in page. */
  clerkPublishableKey: string;
  /** Path to the ffmpeg binary. When blank, we look on PATH. */
  ffmpegPath: string;
  /** Local temp dir for staging proxies before upload. */
  workDir: string;
  /**
   * Base URL of the auto-update feed (where latest.yml / latest-mac.yml live),
   * no trailing slash. Overrides the publish URL baked in at build time.
   * When unset it defaults to <apiBaseUrl>/desktop-agent, so an installed
   * agent can update from the same server it already talks to without any
   * per-machine config.
   */
  updateUrl: string;
  /**
   * Loopback port of the control server Creator Den talks to (health check,
   * launch hand-off, job status polling). Fixed so the web app always knows
   * where to look; override per-machine with NEXET_AGENT_CONTROL_PORT.
   */
  controlPort: number;
}

const DEFAULTS: AgentConfig = {
  apiBaseUrl: "http://localhost:3000",
  // The hosted Nexet web app. The sign-in link lands on its /agent-signin
  // page, and Clerk only initialises on origins registered for the instance,
  // so the shipped default must be the real domain rather than a dev server.
  // Point NEXET_WEB_URL at the local creators-den
  // (http://localhost:5175 — PORT=5175, BASE_PATH=/creators-den/) to develop.
  webAppUrl: "https://nexet.co",
  // Clerk publishable key for the shared Nexet Clerk instance (novel-tortoise-61).
  // Publishable keys are public by design — the web apps embed the same one in
  // their client bundles — so it's safe to ship as the built-in default.
  // Override per-machine with NEXET_CLERK_PUBLISHABLE_KEY or a config file.
  clerkPublishableKey: "pk_test_bm92ZWwtdG9ydG9pc2UtNjEuY2xlcmsuYWNjb3VudHMuZGV2JA",
  ffmpegPath: "",
  workDir: path.join(os.homedir(), ".nexet-agent", "work"),
  updateUrl: "",
  controlPort: 41737,
};

function loadFileConfig(): Partial<AgentConfig> {
  const candidates = [
    path.join(process.cwd(), "nexet-agent.json"),
    path.join(os.homedir(), ".nexet-agent", "config.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      return JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AgentConfig>;
    } catch {
      // ignore malformed config files
    }
  }
  return {};
}

export function loadConfig(): AgentConfig {
  const file = loadFileConfig();
  const apiBaseUrl = (process.env.NEXET_API_URL || file.apiBaseUrl || DEFAULTS.apiBaseUrl).replace(/\/+$/, "");
  return {
    apiBaseUrl,
    webAppUrl: process.env.NEXET_WEB_URL || file.webAppUrl || DEFAULTS.webAppUrl,
    clerkPublishableKey: process.env.NEXET_CLERK_PUBLISHABLE_KEY || file.clerkPublishableKey || DEFAULTS.clerkPublishableKey,
    ffmpegPath: process.env.NEXET_FFMPEG_PATH || file.ffmpegPath || DEFAULTS.ffmpegPath,
    workDir: process.env.NEXET_AGENT_WORK_DIR || file.workDir || DEFAULTS.workDir,
    // No per-machine config needed: updates come from the same host as the
    // API (which serves the agent release feed at /desktop-agent). An explicit
    // NEXET_UPDATE_URL or config-file entry still wins.
    updateUrl: process.env.NEXET_UPDATE_URL || file.updateUrl || `${apiBaseUrl}/desktop-agent`,
    controlPort: Number(process.env.NEXET_AGENT_CONTROL_PORT || file.controlPort || DEFAULTS.controlPort),
  };
}