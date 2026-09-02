// Persisted user settings for the desktop agent. Unlike config.ts (which is
// mostly deployment configuration from env/files), these are UI preferences
// the user changes at runtime — the floating-widget toggle and bubble position.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentSettings } from "../shared/types";

const SETTINGS_DIR = path.join(os.homedir(), ".tandem-agent");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

const DEFAULTS: AgentSettings = {
  widgetEnabled: false,
  widgetAutoShow: true,
  widgetPos: null,
};

export function loadSettings(): AgentSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULTS };
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<AgentSettings>;
    return {
      widgetEnabled: parsed.widgetEnabled ?? DEFAULTS.widgetEnabled,
      widgetAutoShow: parsed.widgetAutoShow ?? DEFAULTS.widgetAutoShow,
      widgetPos: parsed.widgetPos ?? null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: AgentSettings): void {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch {
    // best-effort persistence; the in-memory value still applies this session
  }
}

export { DEFAULTS as DEFAULT_SETTINGS };
