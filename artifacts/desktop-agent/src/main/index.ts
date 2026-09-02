import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadConfig } from "./config";
import { signInWithClerk, clearClerkSession, type AuthSession } from "./auth";
import { ApiClient } from "./api";
import { makeProxy, resolveFfmpeg } from "./ffmpeg";

let mainWindow: BrowserWindow | null = null;
let sessionCache: AuthSession | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 680,
    title: "Tandem Desktop Agent",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
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

ipcMain.handle("agent:sign-in", async () => {
  const cfg = loadConfig();
  sessionCache = await signInWithClerk(cfg.clerkPublishableKey);
  return sessionCache ? { ok: true, email: sessionCache.email } : { ok: false };
});

ipcMain.handle("agent:sign-out", async () => {
  sessionCache = null;
  await clearClerkSession();
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

    await makeProxy({
      ffmpegPath,
      inputPath: opts.localFile,
      outputPath: proxyPath,
      onProgress: () => {},
    });

    const stat = fs.statSync(proxyPath);
    const mint = await api.mintProxyUpload(opts.projectId, opts.assetId, base + "_720p.mp4", stat.size, "video/mp4");
    await api.putToPresigned(mint.uploadUrl, proxyPath, "video/mp4");
    await api.confirmProxy(opts.projectId, opts.assetId);

    return { ok: true, storageKey: mint.storageKey, sizeBytes: stat.size };
  },
);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// Auto-update (electron-updater, lazy-loaded so the app still works without it)
// ---------------------------------------------------------------------------
let autoUpdater: { checkForUpdates: () => void; quitAndInstall: () => void } | null = null;

async function initAutoUpdate(): Promise<void> {
  try {
    // electron-updater is an optional dependency — only used when packaged.
    // @ts-expect-error electron-updater types may not be available in dev
    const { autoUpdater: updater } = await import("electron-updater");
    autoUpdater = updater as typeof autoUpdater;
    if (autoUpdater) {
      autoUpdater.checkForUpdates();
    }
  } catch {
    // Not packaged or electron-updater not installed — skip silently.
  }
}

ipcMain.handle("agent:check-update", () => {
  if (autoUpdater) {
    autoUpdater.checkForUpdates();
    return { ok: true };
  }
  return { ok: false, reason: "auto-updater not available" };
});

ipcMain.handle("agent:install-update", () => {
  if (autoUpdater) {
    autoUpdater.quitAndInstall();
    return { ok: true };
  }
  return { ok: false };
});

app.whenReady().then(async () => {
  createWindow();
  const cfg = loadConfig();
  if (!cfg.clerkPublishableKey) {
    mainWindow?.webContents.send("agent:config-error", "Clerk publishable key is not configured.");
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  await initAutoUpdate();
});

export { mainWindow, os };