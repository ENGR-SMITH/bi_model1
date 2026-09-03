import { app, BrowserWindow, ipcMain, dialog, clipboard, Menu, shell } from "electron";

process.on("unhandledRejection", (reason) => {
  console.error("[agent] unhandled rejection:", reason);
});
import type { AppUpdater } from "electron-updater";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadConfig } from "./config";
import { beginBrowserSignIn, type AuthSession, type BrowserSignInAttempt } from "./auth";
import { ApiClient } from "./api";
import { makeProxy, resolveFfmpeg } from "./ffmpeg";
import { WidgetController } from "./widget";
import { loadSettings } from "./settings";
import type { AgentSettings, AppInfo, AuthEvent, JobProgress, UpdateEvent } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let sessionCache: AuthSession | null = null;
let widgetController: WidgetController | null = null;
let isQuitting = false;

// Only one agent instance at a time — a second launch (e.g. from a leftover
// installer or an old copy still running in the tray) just focuses the window
// that's already there instead of silently competing for the same IPC channels.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMainWindow());
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 880,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: "Tandem Desktop Agent",
    // The agent has no File/Edit/View/Window/Help chrome — those menus belong
    // to document editors, not to this app, and only confuse users.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;

  // With the widget on (Windows), closing the window hides it to the tray so
  // the bubble and detection keep running in the background.
  win.on("close", (e) => {
    if (process.platform === "win32" && widgetController?.enabled && !isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

function requireAuth(): ApiClient {
  const cfg = loadConfig();
  if (!sessionCache) {
    throw new Error("Not signed in");
  }
  return new ApiClient(cfg.apiBaseUrl, sessionCache.token);
}

function ensureAuthenticated(): ApiClient {
  return requireAuth();
}

function sendJobProgress(progress: JobProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("agent:job-progress", progress);
  }
}

// ---------------------------------------------------------------------------
// Sign-in (browser device flow)
// ---------------------------------------------------------------------------
// Signing in happens in the user's own browser: the renderer asks for a link
// (agent:sign-in:begin), shows it with Copy/Open buttons, and the main process
// reports back through agent:auth-event once the browser page finishes the
// Clerk sign-in and hands the session JWT over.
let activeSignIn: BrowserSignInAttempt | null = null;

function sendAuthEvent(event: AuthEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("agent:auth-event", event);
  }
}

ipcMain.handle("agent:sign-in:begin", async () => {
  // A new attempt supersedes any in-flight one (its link stops working).
  activeSignIn?.cancel();
  activeSignIn = null;
  try {
    const cfg = loadConfig();
    const attempt = await beginBrowserSignIn(cfg.clerkPublishableKey, cfg.webAppUrl);
    activeSignIn = attempt;
    void attempt.done.then((session) => {
      if (activeSignIn !== attempt) return; // superseded or cancelled
      activeSignIn = null;
      if (session) {
        sessionCache = session;
        sendAuthEvent({ type: "signed-in", email: session.email });
      } else {
        sendAuthEvent({ type: "expired" });
      }
    });
    return { ok: true, url: attempt.url } as const;
  } catch (err) {
    return { ok: false, error: (err as Error).message } as const;
  }
});

ipcMain.handle("agent:sign-in:cancel", () => {
  activeSignIn?.cancel();
  activeSignIn = null;
  return { ok: true };
});

// Opens a link in the user's default browser (used for the sign-in link).
ipcMain.handle("agent:open-external", async (_e, url: string) => {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    return { ok: false, error: "Only http(s) links can be opened." };
  }
  await shell.openExternal(url);
  return { ok: true };
});

// Copies text to the system clipboard (used for the sign-in link).
ipcMain.handle("agent:copy-text", (_e, text: string) => {
  clipboard.writeText(typeof text === "string" ? text : "");
  return { ok: true };
});

// Lets the renderer ask about missing config instead of relying on a one-shot
// push that can be dropped if it's sent before the page has loaded.
ipcMain.handle("agent:config-status", (): { clerkConfigured: boolean } => {
  const cfg = loadConfig();
  return { clerkConfigured: Boolean(cfg.clerkPublishableKey) };
});

ipcMain.handle("agent:sign-out", () => {
  activeSignIn?.cancel();
  activeSignIn = null;
  sessionCache = null;
  return { ok: true };
});

ipcMain.handle("agent:whoami", () => {
  return sessionCache
    ? { signedIn: true, email: sessionCache.email, userId: sessionCache.userId }
    : { signedIn: false };
});

ipcMain.handle("agent:list-projects", async () => {
  const api = ensureAuthenticated();
  const projects = await api.listProjects();
  return projects;
});

ipcMain.handle("agent:list-assets", async (_e, projectId: string) => {
  const api = ensureAuthenticated();
  return api.listAssets(String(projectId));
});

ipcMain.handle("agent:pick-file", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: ["mp4", "mov", "mxf", "mkv", "avi", "m4v"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// The core job: generate a proxy with local FFmpeg and push it straight to R2.
// Progress is streamed back to the caller as `agent:job-progress` events so the
// UI can animate the encode (proxy phase) and the upload (upload phase).
ipcMain.handle(
  "agent:upload-proxy",
  async (_e, opts: { projectId: string; assetId: string; localFile: string }) => {
    const cfg = loadConfig();
    const api = ensureAuthenticated();
    const ffmpegPath = resolveFfmpeg(cfg.ffmpegPath);

    const workDir = path.join(cfg.workDir, opts.projectId);
    fs.mkdirSync(workDir, { recursive: true });
    const base = path.basename(opts.localFile).replace(/\.[^.]+$/, "");
    const proxyPath = path.join(workDir, `${base}_720p.mp4`);

    sendJobProgress({ phase: "proxy", percent: -1 });
    await makeProxy({
      ffmpegPath,
      inputPath: opts.localFile,
      outputPath: proxyPath,
      onProgress: ({ percent }) => sendJobProgress({ phase: "proxy", percent }),
    });

    const stat = fs.statSync(proxyPath);
    const mint = await api.mintProxyUpload(opts.projectId, opts.assetId, base + "_720p.mp4", stat.size, "video/mp4");
    await api.putToPresigned(mint.uploadUrl, proxyPath, "video/mp4", (sentBytes, totalBytes) =>
      sendJobProgress({
        phase: "upload",
        percent: totalBytes > 0 ? Math.round((sentBytes / totalBytes) * 100) : -1,
        sentBytes,
        totalBytes,
      }),
    );
    await api.confirmProxy(opts.projectId, opts.assetId);

    return { ok: true, storageKey: mint.storageKey, sizeBytes: stat.size };
  },
);

// ---------------------------------------------------------------------------
// App info
// ---------------------------------------------------------------------------
ipcMain.handle("agent:app-info", (): AppInfo => {
  return {
    version: app.getVersion(),
    platform: process.platform,
    packaged: app.isPackaged,
  };
});

// ---------------------------------------------------------------------------
// Settings + floating widget
// ---------------------------------------------------------------------------
ipcMain.handle("agent:get-settings", (): AgentSettings => {
  return widgetController ? widgetController.snapshot() : loadSettings();
});

ipcMain.handle("agent:set-widget", (_e, patch: Partial<AgentSettings>): AgentSettings => {
  const next = widgetController ? widgetController.update(patch) : { ...loadSettings(), ...patch };
  // Disabling the widget while the main window is tucked away in the tray
  // means the user has nothing to come back to — shut the app down.
  if (
    process.platform === "win32" &&
    !next.widgetEnabled &&
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.isVisible()
  ) {
    app.quit();
  }
  return next;
});

ipcMain.handle("agent:widget-open-app", () => {
  showMainWindow();
  widgetController?.hideBubble();
  return { ok: true };
});

ipcMain.handle("agent:widget-hide", () => {
  widgetController?.hideBubble();
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Auto-update (electron-updater). Runs only when packaged: the updater needs
// the app-update.yml that electron-builder bakes into the installer build.
// ---------------------------------------------------------------------------
let updater: AppUpdater | null = null;

function sendUpdateEvent(update: UpdateEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("agent:update-event", update);
  }
}

async function initAutoUpdate(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = await import("electron-updater");
    const cfg = loadConfig();
    // Allow a runtime override of the feed baked in at build time
    // (package.json build.publish.url). Useful when the API domain differs
    // from the artifact host.
    if (cfg.updateUrl) {
      autoUpdater.setFeedURL({ provider: "generic", url: cfg.updateUrl });
    }
    autoUpdater.autoDownload = true;
    autoUpdater.on("checking-for-update", () => sendUpdateEvent({ type: "checking" }));
    autoUpdater.on("update-available", (info) =>
      sendUpdateEvent({ type: "available", version: info.version }),
    );
    autoUpdater.on("update-not-available", () => sendUpdateEvent({ type: "not-available" }));
    autoUpdater.on("download-progress", (p) =>
      sendUpdateEvent({ type: "downloading", percent: Math.round(p.percent) }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      sendUpdateEvent({ type: "downloaded", version: info.version }),
    );
    autoUpdater.on("error", (err) =>
      sendUpdateEvent({ type: "error", error: err?.message ?? String(err) }),
    );
    updater = autoUpdater;
    void autoUpdater.checkForUpdates();
  } catch {
    updater = null;
  }
}

ipcMain.handle("agent:check-update", async () => {
  if (!updater) {
    return { ok: false, reason: "Update checks only work in the installed app." };
  }
  try {
    await updater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
});

ipcMain.handle("agent:install-update", () => {
  if (updater) {
    updater.quitAndInstall();
    return { ok: true };
  }
  return { ok: false };
});

app.on("window-all-closed", () => {
  const keepAlive = process.platform === "win32" && widgetController?.enabled === true;
  if (process.platform !== "darwin" && !keepAlive) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.whenReady().then(async () => {
  // Drop the default File/Edit/View/Window/Help menu bar — it's not relevant
  // to the agent. Windows/Linux get no menu at all; macOS keeps a minimal app
  // menu so standard shortcuts (Cmd+C/V/Q, window management) keep working.
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  widgetController = new WidgetController({
    openMainWindow: showMainWindow,
    isMainWindowFocused: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused(),
  });
  widgetController.init();
  createWindow();
  const cfg = loadConfig();
  if (!cfg.clerkPublishableKey) {
    mainWindow?.webContents.send("agent:config-error", "Clerk publishable key is not configured.");
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
  await initAutoUpdate();
});

export { mainWindow, os };
