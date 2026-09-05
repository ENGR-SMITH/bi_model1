// Floating-widget controller (Windows-first, Grammarly-style):
//
//  * a small draggable, always-on-top bubble window that lives over whatever
//    the user is doing and opens the agent when clicked,
//  * auto-show while a video is playing anywhere on the OS (Windows media
//    session), with a tray menu + global hotkey as the manual fallback,
//  * the whole thing is a setting the user toggles from the agent window.
//
// On non-Windows platforms the controller is inert (no tray, no detection),
// but the bubble API still works so the settings UI can behave consistently.
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  nativeImage,
  screen,
} from "electron";
import path from "node:path";
import { isVideoPlaying, listMediaSessions } from "./media-session";
import { loadSettings, saveSettings } from "./settings";
import type { AgentSettings } from "../shared/types";

const BUBBLE_WIDTH = 56;
const BUBBLE_HEIGHT = 56;
const POLL_INTERVAL_MS = 3000;
const HOTKEY = "CommandOrControl+Alt+T";

/** 16x16 red dot with a white "T" — generated, no asset file needed. */
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAS0lEQVR4nGNgoBX4jwZI1vhcXB4FE2UQuq24AE7NyDbhAjA1OA3A5mxs4gQ14zMAw5BhYADFgUgVA/B5hSjN6KmRrKSMzSCSNZIKAM8QtADsAICfAAAAAElFTkSuQmCC";

export interface WidgetControllerOptions {
  /** Focus (or create + focus) the main agent window. */
  openMainWindow: () => void;
  /** True while the main agent window exists and is focused. */
  isMainWindowFocused: () => boolean;
}

export class WidgetController {
  private settings: AgentSettings;
  private bubble: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private pinned = false;
  private emptyStreak = 0;
  private positionSaveTimer: NodeJS.Timeout | null = null;
  private quitting = false;

  constructor(private opts: WidgetControllerOptions) {
    this.settings = loadSettings();
    app.on("before-quit", () => {
      this.quitting = true;
      this.stop();
    });
  }

  get enabled(): boolean {
    return this.settings.widgetEnabled;
  }

  /** Copy of the current settings (kept private so it's only changed via update()). */
  snapshot(): AgentSettings {
    return { ...this.settings };
  }

  /** Apply a settings patch, persisting it and (re)starting/stopping the widget. */
  update(patch: Partial<AgentSettings>): AgentSettings {
    this.settings = { ...loadSettings(), ...patch };
    // The settings UI is a single "Widget" switch: ON means the floating
    // bubble AND auto-show while a video plays; OFF disables both. Keep them
    // in lockstep so a programmatic patch can never split the feature.
    if (patch.widgetEnabled !== undefined) {
      this.settings.widgetAutoShow = patch.widgetEnabled;
    }
    if (process.platform !== "win32") {
      // Widget machinery is Windows-only; never let the toggle pretend otherwise.
      this.settings = { ...this.settings, widgetEnabled: false };
    }
    saveSettings(this.settings);
    if (this.enabled) this.start();
    else this.stop();
    return { ...this.settings };
  }

  /** Called once after app ready. Starts the widget if it's enabled. */
  init(): void {
    if (this.enabled) this.start();
  }

  /** Tray/hotkey fallback: show-and-pin or hide-and-unpin the bubble. */
  toggleBubble(): void {
    if (this.bubble?.isVisible() && this.pinned) {
      this.hideBubble();
    } else {
      this.pinned = true;
      this.showBubble();
    }
    this.refreshTrayMenu();
  }

  /** Dismiss the bubble (used by its ✕ and after opening the agent). */
  hideBubble(): void {
    const wasVisible = !!this.bubble && !this.bubble.isDestroyed() && this.bubble.isVisible();
    this.pinned = false;
    this.emptyStreak = 0;
    if (wasVisible) {
      this.bubble?.hide();
      this.refreshTrayMenu();
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  private start(): void {
    if (process.platform !== "win32") return;
    this.stop();
    this.createTray();
    this.createBubble();
    try {
      globalShortcut.register(HOTKEY, () => this.toggleBubble());
    } catch {
      // hotkey already taken — tray remains as the fallback
    }
    // Enabling the widget engages it immediately: the bubble shows right away
    // (and stays pinned until dismissed), instead of waiting for a video to
    // start playing somewhere. Auto-show then re-summons it after a manual ✕.
    this.pinned = true;
    this.showBubble();
    if (this.settings.widgetAutoShow) {
      this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    }
  }

  private stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.emptyStreak = 0;
    try {
      globalShortcut.unregister(HOTKEY);
    } catch {
      // not registered
    }
    if (this.positionSaveTimer) {
      clearTimeout(this.positionSaveTimer);
      this.positionSaveTimer = null;
    }
    if (this.bubble && !this.bubble.isDestroyed()) this.bubble.destroy();
    this.bubble = null;
    if (this.tray) this.tray.destroy();
    this.tray = null;
  }

  // ---------------------------------------------------------------------------
  // Bubble window
  // ---------------------------------------------------------------------------
  private createBubble(): void {
    const win = new BrowserWindow({
      width: BUBBLE_WIDTH,
      height: BUBBLE_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      title: "Tandem widget",
      webPreferences: {
        preload: path.join(__dirname, "..", "preload", "index.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // Keep the bubble above fullscreen video/other apps.
    win.setAlwaysOnTop(true, "screen-saver");
    try {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      // not supported on this platform — fine
    }
    win.setSkipTaskbar(true);

    // Remember where the user parked the bubble.
    win.on("moved", () => {
      if (this.positionSaveTimer) clearTimeout(this.positionSaveTimer);
      this.positionSaveTimer = setTimeout(() => {
        if (!win.isDestroyed()) {
          const [x, y] = win.getPosition();
          this.settings = { ...this.settings, widgetPos: { x, y } };
          saveSettings(this.settings);
        }
      }, 400);
    });

    void win.loadFile(path.join(__dirname, "..", "renderer", "bubble.html"));
    this.bubble = win;
  }

  private clampToWorkArea(x: number, y: number): { x: number; y: number } {
    const display = screen.getDisplayNearestPoint({ x, y });
    const { x: ax, y: ay, width, height } = display.workArea;
    const maxX = ax + width - BUBBLE_WIDTH;
    const maxY = ay + height - BUBBLE_HEIGHT;
    return {
      x: Math.min(Math.max(x, ax), maxX),
      y: Math.min(Math.max(y, ay), maxY),
    };
  }

  private showBubble(): void {
    if (!this.enabled || !this.bubble || this.bubble.isDestroyed()) return;
    const wasVisible = this.bubble.isVisible();
    let { x, y } = this.settings.widgetPos ?? { x: 0, y: 0 };
    if (!this.settings.widgetPos) {
      // Default: bottom-right corner of the primary display.
      const { workArea } = screen.getPrimaryDisplay();
      x = workArea.x + workArea.width - BUBBLE_WIDTH - 24;
      y = workArea.y + workArea.height - BUBBLE_HEIGHT - 24;
    }
    const pos = this.clampToWorkArea(x, y);
    this.bubble.setPosition(pos.x, pos.y);
    // showInactive so we never steal focus from the video that's playing.
    this.bubble.showInactive();
    if (!wasVisible) this.refreshTrayMenu();
  }

  // ---------------------------------------------------------------------------
  // Detection loop
  // ---------------------------------------------------------------------------
  private async poll(): Promise<void> {
    if (!this.enabled || !this.settings.widgetAutoShow || this.quitting) return;
    // If the user is busy in the agent itself, don't hover a bubble over it.
    if (this.opts.isMainWindowFocused()) {
      if (this.bubble?.isVisible() && !this.pinned) this.hideBubble();
      return;
    }
    const playing = isVideoPlaying(await listMediaSessions());
    if (playing) {
      this.emptyStreak = 0;
      if (!this.bubble?.isVisible()) this.showBubble();
    } else if (!this.pinned) {
      this.emptyStreak += 1;
      // Require two consecutive empty polls (~6s) so brief pauses don't flicker.
      if (this.emptyStreak >= 2 && this.bubble?.isVisible()) this.hideBubble();
    }
  }

  // ---------------------------------------------------------------------------
  // Tray
  // ---------------------------------------------------------------------------
  private createTray(): void {
    const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
    const tray = new Tray(icon);
    tray.setToolTip("Tandem Desktop Agent");
    tray.on("click", () => this.opts.openMainWindow());
    this.tray = tray;
    this.refreshTrayMenu();
  }

  private refreshTrayMenu(): void {
    if (!this.tray) return;
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Tandem Agent", click: () => this.opts.openMainWindow() },
        {
          label: this.bubble?.isVisible() ? "Hide video widget" : "Show video widget",
          click: () => this.toggleBubble(),
        },
        { type: "separator" },
        {
          label: "Widget settings…",
          click: () => this.opts.openMainWindow(),
        },
        { type: "separator" },
        { label: "Quit Tandem Agent", click: () => app.quit() },
      ]),
    );
  }
}
