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
import { uploadRawMultipart } from "./upload-raw";
import { WidgetController } from "./widget";
import { loadSettings } from "./settings";
import {
  startControlServer,
  markJobStart,
  markJobDone,
  markLaunchContext,
  getLaunchContext,
  isAllowedReturnUrl,
} from "./control-server";
import type { AgentSettings, AppInfo, AuthEvent, JobProgress, LaunchContext, UpdateEvent } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let sessionCache: AuthSession | null = null;
let widgetController: WidgetController | null = null;
let isQuitting = false;

// Custom URL scheme registered at install (and at runtime below) so Creator
// Den can launch the agent even when it isn't running: `tandem-agent://launch
// ?projectId=…&returnUrl=…` is handed to the OS, which starts the app and
// passes the URL back in here.
const AGENT_PROTOCOL = "tandem-agent";
let pendingStartupLink: string | null = null;

// Only one agent instance at a time — a second launch (e.g. from a leftover
// installer or an old copy still running in the tray) just focuses the window
// that's already there instead of silently competing for the same IPC channels.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  // A second launch (installer, deep link, old copy) focuses the running app.
  // Windows/Linux hand deep links to the first instance as an argv entry.
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((arg) => arg.startsWith(AGENT_PROTOCOL + "://"));
    if (link) handleAgentDeepLink(link);
    else showMainWindow();
  });
  // macOS hands deep links to the running app via open-url instead.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleAgentDeepLink(url);
  });
}

// Cold start via a deep link (Windows/Linux pass the URL as an argv entry).
// Processed once the window exists — handled at the top of whenReady().
pendingStartupLink = process.argv.find((arg) => arg.startsWith(AGENT_PROTOCOL + "://")) ?? null;

// Register the scheme for dev builds; packaged installs register it via the
// electron-builder `protocols` entry, this just keeps `pnpm dev` working.
try {
  app.setAsDefaultProtocolClient(AGENT_PROTOCOL);
} catch {
  // non-Windows dev environments can fail silently — the deep link still works
  // when the installer registered the scheme
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
// Creator Den hand-off (launch + auto-redirect back)
// ---------------------------------------------------------------------------
// Creator Den launches the agent for an upload via the control server's
// POST /launch or the tandem-agent:// deep link. We remember the project to
// preselect + the page to reopen, focus the app, and tell the renderer. When
// the upload job succeeds we reopen that page (shell.openExternal) — the
// user lands back on Creator Den with the file in the vault, automatically.

function parseAgentDeepLink(raw: string): LaunchContext | null {
  if (!raw || !raw.startsWith(AGENT_PROTOCOL + "://")) return null;
  try {
    const url = new URL(raw);
    if (url.host !== "launch") return null;
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const returnUrl = url.searchParams.get("returnUrl") ?? undefined;
    return {
      projectId: projectId && projectId.length > 0 ? projectId : undefined,
      returnUrl: returnUrl && returnUrl.length > 0 ? returnUrl : undefined,
    };
  } catch {
    return null;
  }
}

function handleLaunchContext(ctx: LaunchContext): void {
  markLaunchContext(ctx);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("agent:launch-context", ctx);
  }
  showMainWindow();
}

function handleAgentDeepLink(raw: string): void {
  const ctx = parseAgentDeepLink(raw);
  if (!ctx) return;
  const cfg = loadConfig();
  if (!isAllowedReturnUrl(ctx.returnUrl, cfg.webAppUrl)) ctx.returnUrl = undefined;
  // macOS can deliver the URL before the window exists (open-url fires ahead
  // of whenReady) — queue it and let whenReady replay the hand-off.
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingStartupLink = raw;
    return;
  }
  handleLaunchContext(ctx);
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
        sendAuthEvent({ type: "signed-in", email: session.email, name: session.name, imageUrl: session.imageUrl });
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
    ? {
        signedIn: true,
        email: sessionCache.email,
        name: sessionCache.name,
        imageUrl: sessionCache.imageUrl,
        userId: sessionCache.userId,
      }
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

// Extensions the agent can put into the vault (fallback when the renderer
// doesn't narrow the picker to the member's roles).
const DEFAULT_PICK_EXTENSIONS = [
  "mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg",
  "wav", "mp3", "m4a", "aac", "flac", "ogg", "aif", "aiff", "opus",
  "png", "jpg", "jpeg", "webp", "gif", "avif",
];

// The renderer passes the file extensions its roles allow (e.g. a Video role
// sends only video extensions) so the OS picker can't offer cross-role files.
ipcMain.handle("agent:pick-file", async (_e, extensions?: string[]) => {
  const allowed = Array.isArray(extensions) && extensions.length > 0 ? extensions : DEFAULT_PICK_EXTENSIONS;
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Allowed files", extensions: allowed }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// The roles the signed-in viewer holds on a project — the renderer uses them
// to show which roles it can upload for and to restrict file types to the
// kinds those roles own (the API enforces the same rule on every upload).
ipcMain.handle("agent:project-roles", async (_e, projectId: string) => {
  const api = ensureAuthenticated();
  const detail = await api.getProject(String(projectId));
  return { myRoles: detail.myRoles ?? [] };
});

// Metadata for a file the user picked or dropped: the renderer shows name +
// size on the dropzone chip. Kept in main so the renderer never needs fs.
ipcMain.handle("agent:file-info", (_e, filePath: string) => {
  const p = String(filePath ?? "");
  if (!p) return null;
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return null;
    return { path: p, name: path.basename(p), sizeBytes: stat.size };
  } catch {
    return null;
  }
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
    const launchCtx = getLaunchContext();
    // Surface this job to Creator Den's control server so the page that
    // launched the agent knows when the upload finished.
    markJobStart({
      projectId: opts.projectId,
      fileName: path.basename(opts.localFile),
      returnUrl: launchCtx.returnUrl,
    });

    const workDir = path.join(cfg.workDir, opts.projectId);
    fs.mkdirSync(workDir, { recursive: true });
    const base = path.basename(opts.localFile).replace(/\.[^.]+$/, "");
    const proxyPath = path.join(workDir, `${base}_720p.mp4`);

    try {
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

      markJobDone();
      // Auto-redirect the user back to Creator Den: reopen the page they
      // launched from now that the file is in the vault.
      if (launchCtx.returnUrl && isAllowedReturnUrl(launchCtx.returnUrl, cfg.webAppUrl)) {
        void shell.openExternal(launchCtx.returnUrl);
      }
      return { ok: true, storageKey: mint.storageKey, sizeBytes: stat.size };
    } catch (err) {
      markJobDone((err as Error).message);
      // The agent reuses the Clerk session token captured at sign-in, and it
      // is short-lived — when the API answers 401 the token is stale, so drop
      // the session and ask for a fresh sign-in instead of a cryptic failure.
      const message = (err as Error).message ?? "";
      if (/failed \(401\)|Authentication required/i.test(message)) {
        sessionCache = null;
        sendAuthEvent({ type: "session-expired", error: "Your sign-in expired. Sign in again to upload." });
      }
      throw err;
    }
  },
);

// ---------------------------------------------------------------------------
// Raw vault upload (drag & drop / choose from the PC)
// ---------------------------------------------------------------------------
// The agent streams the picked raw file into the vault as a NEW asset — no
// asset dropdown: the file itself is the upload. Progress streams back as
// agent:job-progress (phase "upload"), and the job record (control server)
// is marked so a Creator Den page that launched the agent can refresh + the
// agent reopens its return URL when the file lands.
ipcMain.handle(
  "agent:upload-raw",
  async (_e, opts: { projectId: string; localFile: string }) => {
    const cfg = loadConfig();
    ensureAuthenticated(); // fail fast when not signed in
    const launchCtx = getLaunchContext();
    const fileName = path.basename(String(opts.localFile ?? ""));
    if (!opts.projectId || !opts.localFile || !fileName) {
      throw new Error("Pick a project and a file first.");
    }
    if (!fs.existsSync(opts.localFile)) {
      throw new Error("That file no longer exists on this computer.");
    }

    markJobStart({ projectId: opts.projectId, fileName, returnUrl: launchCtx.returnUrl });
    try {
      sendJobProgress({ phase: "upload", percent: -1 });
      const result = await uploadRawMultipart({
        apiBaseUrl: cfg.apiBaseUrl,
        token: sessionCache!.token,
        projectId: opts.projectId,
        filePath: opts.localFile,
        onProgress: (sentBytes, totalBytes) =>
          sendJobProgress({
            phase: "upload",
            percent: totalBytes > 0 ? Math.round((sentBytes / totalBytes) * 100) : -1,
            sentBytes,
            totalBytes,
          }),
      });
      markJobDone();
      if (launchCtx.returnUrl && isAllowedReturnUrl(launchCtx.returnUrl, cfg.webAppUrl)) {
        void shell.openExternal(launchCtx.returnUrl);
      }
      return { ok: true, assetId: result.assetId, fileName: result.fileName } as const;
    } catch (err) {
      const message = (err as Error).message ?? "";
      markJobDone(message);
      // Same short-lived-token handling as the proxy job: drop the session and
      // auto re-sign-in when the API rejects our bearer token.
      if (/failed \(401\)|Authentication required/i.test(message)) {
        sessionCache = null;
        sendAuthEvent({ type: "session-expired", error: "Your sign-in expired. Sign in again to upload." });
      }
      throw err;
    }
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

  // Creator Den hand-off: the loopback control server lets the web app detect
  // a running agent, launch it with a project + return URL, and watch the job.
  startControlServer({
    webAppUrl: cfg.webAppUrl,
    port: cfg.controlPort,
    getVersion: () => app.getVersion(),
    isSignedIn: () => sessionCache !== null,
    onLaunch: handleLaunchContext,
  });
  if (pendingStartupLink) {
    handleAgentDeepLink(pendingStartupLink);
    pendingStartupLink = null;
  }
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
