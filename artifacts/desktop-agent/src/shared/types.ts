// Types shared between main, preload and renderer processes (type-only;
// nothing here is imported at runtime outside of type positions).

/** User-adjustable settings, persisted to ~/.nexet-agent/settings.json. */
export interface AgentSettings {
  /** Master switch for the floating widget (bubble + tray + detection). */
  widgetEnabled: boolean;
  /** Auto-show the bubble while a video is playing on the OS. The settings UI
   * is a single "Widget" switch, so this moves in lockstep with
   * `widgetEnabled` — on enables auto-show, off disables it. */
  widgetAutoShow: boolean;
  /** Last position of the floating bubble, saved so it stays where the user dragged it. */
  widgetPos: { x: number; y: number } | null;
}

/** Live progress event streamed from the main process during a proxy job. */
export interface JobProgress {
  phase: "proxy" | "upload";
  /** 0-100 once known; -1 while progress can't be measured yet. */
  percent: number;
  sentBytes?: number;
  totalBytes?: number;
}

/** Auto-update lifecycle events forwarded from electron-updater. */
export interface UpdateEvent {
  type:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  version?: string;
  percent?: number;
  error?: string;
}

/**
 * Sign-in lifecycle events pushed to the renderer while a browser sign-in
 * attempt is in flight (or once it completes). The actual link + waiting UI
 * lives in the renderer; the main process only reports what happened.
 */
export type AuthEvent =
  | { type: "signed-in"; email: string | null; name?: string | null; imageUrl?: string | null }
  | { type: "expired"; error?: string }
  | { type: "cancelled" }
  | { type: "error"; error: string }
  /** The API rejected our bearer token (401) — the Clerk session the agent
   * captured at sign-in is short-lived, so the app must sign in again. */
  | { type: "session-expired"; error?: string };

export interface AppInfo {
  version: string;
  platform: string;
  packaged: boolean;
}

/** Which configuration layer supplied a resolved value. */
export type ConfigSource = "env" | "file" | "default";

/**
 * The resolved deployment config, surfaced in the UI so a stale override is
 * visible: an old nexet-agent.json or an exported NEXET_WEB_URL would
 * otherwise send sign-in at a dev origin with nothing on screen explaining why.
 */
export interface ConfigStatus {
  clerkConfigured: boolean;
  apiBaseUrl: string;
  webAppUrl: string;
  apiBaseUrlSource: ConfigSource;
  webAppUrlSource: ConfigSource;
  /** True when an env var or a config file — not the built-in default — chose
   * the API / sign-in origins. */
  overridden: boolean;
  /** What did the overriding — "environment variables" or the config file's
   * path — or null when the shipped defaults are in effect. */
  overrideSource: string | null;
  /** Absolute path of the config file that was read, when one was. */
  configFile: string | null;
}

/**
 * Context handed to the agent when Creator Den launches it for an upload:
 * which project to preselect, and the page to reopen once the upload lands
 * (so the user is automatically back on Creator Den).
 */
export interface LaunchContext {
  projectId?: string;
  returnUrl?: string;
}

/**
 * The agent's most recent upload job, as reported to Creator Den's control
 * server so the web page knows when to refresh / redirect back.
 */
export interface AgentJobStatus {
  running: boolean;
  done: boolean;
  error?: string;
  projectId?: string;
  fileName?: string;
  returnUrl?: string;
}
