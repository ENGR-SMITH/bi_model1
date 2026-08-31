// Configuration for the desktop agent. Values come from, in order of priority:
//  1. process.env
//  2. a JSON config file adjacent to the app (config.json / ~/.tandem-agent.json)
//  3. in-code defaults
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AgentConfig {
  /** Base URL of the Tandem API server, no trailing slash. */
  apiBaseUrl: string;
  /** Clerk publishable key for the sign-in window. */
  clerkPublishableKey: string;
  /** Path to the ffmpeg binary. When blank, we look on PATH. */
  ffmpegPath: string;
  /** Local temp dir for staging proxies before upload. */
  workDir: string;
}

const DEFAULTS: AgentConfig = {
  apiBaseUrl: "http://localhost:3000",
  clerkPublishableKey: "",
  ffmpegPath: "",
  workDir: path.join(os.homedir(), ".tandem-agent", "work"),
};

function loadFileConfig(): Partial<AgentConfig> {
  const candidates = [
    path.join(process.cwd(), "tandem-agent.json"),
    path.join(os.homedir(), ".tandem-agent", "config.json"),
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
  return {
    apiBaseUrl: process.env.TANDEM_API_URL || file.apiBaseUrl || DEFAULTS.apiBaseUrl,
    clerkPublishableKey: process.env.TANDEM_CLERK_PUBLISHABLE_KEY || file.clerkPublishableKey || DEFAULTS.clerkPublishableKey,
    ffmpegPath: process.env.TANDEM_FFMPEG_PATH || file.ffmpegPath || DEFAULTS.ffmpegPath,
    workDir: process.env.TANDEM_AGENT_WORK_DIR || file.workDir || DEFAULTS.workDir,
  };
}