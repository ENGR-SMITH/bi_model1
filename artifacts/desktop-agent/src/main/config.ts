// Configuration for the desktop agent. Values come from, in order of priority:
//  1. process.env
//  2. a JSON config file — NEXET_AGENT_CONFIG, else nexet-agent.json next to
//     the installed app or in the working directory, else
//     ~/.nexet-agent/config.json or ~/.nexet-agent.json
//  3. in-code defaults (the hosted https://nexet.co deployment)
//
// resolveConfig() reports WHICH layer supplied each value, so a stale override
// — an old nexet-agent.json still pointing at a dev server, an exported
// NEXET_WEB_URL — is visible in the UI and the start-up log instead of
// silently winning over the shipped default.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConfigSource } from "../shared/types";

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
   * When unset it defaults to <apiBaseUrl>/desktop-agent, which the production
   * deployment answers by redirecting to the published feed.
   */
  updateUrl: string;
  /**
   * Loopback port of the control server Creator Den talks to (health check,
   * launch hand-off, job status polling). Fixed so the web app always knows
   * where to look; override per-machine with NEXET_AGENT_CONTROL_PORT.
   */
  controlPort: number;
}

/** A resolved config plus the provenance of each field. */
export interface ResolvedConfig {
  apiBaseUrl: string;
  webAppUrl: string;
  sources: {
    apiBaseUrl: ConfigSource;
    webAppUrl: ConfigSource;
    clerkPublishableKey: ConfigSource;
  };
  /** Absolute path of the config file that was read, when one was. */
  file: string | null;
}

// The production deployment serves the four SPAs, the API (/api) and Socket.IO
// (/socket.io) from ONE origin, so both the API base and the web app URL are
// the real domain. Local development overrides either with NEXET_API_URL /
// NEXET_WEB_URL (or a config file).
const DEFAULTS: AgentConfig = {
  apiBaseUrl: "https://nexet.co",
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

/**
 * Where a config file may live, in priority order. "Next to the app" means the
 * folder holding the running binary for an installed build; the working
 * directory is where `pnpm dev` runs, and where a shortcut whose Start-in
 * folder is the install directory lands.
 */
function configFileCandidates(): string[] {
  const explicit = process.env.NEXET_AGENT_CONFIG?.trim();
  const candidates = explicit ? [explicit] : [];
  candidates.push(path.join(path.dirname(process.execPath), "nexet-agent.json"));
  candidates.push(path.join(process.cwd(), "nexet-agent.json"));
  candidates.push(path.join(os.homedir(), ".nexet-agent", "config.json"));
  candidates.push(path.join(os.homedir(), ".nexet-agent.json"));
  return candidates;
}

function loadFileConfig(): { values: Partial<AgentConfig>; file: string | null } {
  const seen = new Set<string>();
  for (const file of configFileCandidates()) {
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      if (!fs.existsSync(file)) continue;
      return { values: JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AgentConfig>, file };
    } catch {
      // ignore malformed config files
    }
  }
  return { values: {}, file: null };
}

/** env wins, then the config file, then the built-in default. */
function resolveField(
  envValue: string | undefined,
  fileValue: string | undefined,
  fallback: string,
  stripTrailingSlash = false,
): { value: string; source: ConfigSource } {
  const clean = (value: string) => (stripTrailingSlash ? value.replace(/\/+$/, "") : value);
  if (envValue) return { value: clean(envValue), source: "env" };
  if (fileValue) return { value: clean(fileValue), source: "file" };
  return { value: clean(fallback), source: "default" };
}

let loggedResolution = false;

/** One line per process: what is in effect, and which layer chose it. */
function logResolution(resolved: ResolvedConfig): void {
  if (loggedResolution) return;
  loggedResolution = true;
  const origin = resolved.file ? ` file=${resolved.file}` : "";
  console.log(
    `[nexet-agent] api=${resolved.apiBaseUrl} (${resolved.sources.apiBaseUrl})` +
      ` web=${resolved.webAppUrl} (${resolved.sources.webAppUrl})${origin}`,
  );
}

export function resolveConfig(): { config: AgentConfig; resolved: ResolvedConfig } {
  const { values: file, file: configFile } = loadFileConfig();
  const api = resolveField(process.env.NEXET_API_URL, file.apiBaseUrl, DEFAULTS.apiBaseUrl, true);
  const web = resolveField(process.env.NEXET_WEB_URL, file.webAppUrl, DEFAULTS.webAppUrl, true);
  const clerk = resolveField(
    process.env.NEXET_CLERK_PUBLISHABLE_KEY,
    file.clerkPublishableKey,
    DEFAULTS.clerkPublishableKey,
  );

  const config: AgentConfig = {
    apiBaseUrl: api.value,
    webAppUrl: web.value,
    clerkPublishableKey: clerk.value,
    ffmpegPath: process.env.NEXET_FFMPEG_PATH || file.ffmpegPath || DEFAULTS.ffmpegPath,
    workDir: process.env.NEXET_AGENT_WORK_DIR || file.workDir || DEFAULTS.workDir,
    // No per-machine config needed: the deployment answers /desktop-agent by
    // redirecting to the published feed. An explicit NEXET_UPDATE_URL or
    // config-file entry still wins.
    updateUrl: process.env.NEXET_UPDATE_URL || file.updateUrl || `${api.value}/desktop-agent`,
    controlPort: Number(process.env.NEXET_AGENT_CONTROL_PORT || file.controlPort || DEFAULTS.controlPort),
  };
  const resolved: ResolvedConfig = {
    apiBaseUrl: config.apiBaseUrl,
    webAppUrl: config.webAppUrl,
    sources: {
      apiBaseUrl: api.source,
      webAppUrl: web.source,
      clerkPublishableKey: clerk.source,
    },
    file: configFile,
  };
  logResolution(resolved);
  return { config, resolved };
}

export function loadConfig(): AgentConfig {
  return resolveConfig().config;
}

/** The resolved values plus their provenance (for the UI and the start-up log). */
export function describeConfig(): ResolvedConfig {
  return resolveConfig().resolved;
}
