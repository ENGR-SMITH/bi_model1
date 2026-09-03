import { contextBridge, ipcRenderer } from "electron";
import type { AgentSettings, AppInfo, AuthEvent, JobProgress, UpdateEvent } from "../shared/types";

/** Subscribe helper: returns an unsubscribe function. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  // Browser sign-in (device flow): begin returns the sign-in link to show in
  // the UI; completion/failure arrives via onAuthEvent.
  signInBegin: () => ipcRenderer.invoke("agent:sign-in:begin"),
  signInCancel: () => ipcRenderer.invoke("agent:sign-in:cancel"),
  openExternal: (url: string) => ipcRenderer.invoke("agent:open-external", url),
  copyText: (text: string) => ipcRenderer.invoke("agent:copy-text", text),
  onAuthEvent: (cb: (event: AuthEvent) => void) => on<AuthEvent>("agent:auth-event", cb),

  signOut: () => ipcRenderer.invoke("agent:sign-out"),
  whoami: () => ipcRenderer.invoke("agent:whoami"),
  listProjects: () => ipcRenderer.invoke("agent:list-projects"),
  listAssets: (projectId: string) => ipcRenderer.invoke("agent:list-assets", projectId),
  pickFile: () => ipcRenderer.invoke("agent:pick-file"),
  uploadProxy: (opts: { projectId: string; assetId: string; localFile: string }) =>
    ipcRenderer.invoke("agent:upload-proxy", opts),

  // Live progress for the in-flight Generate proxy & upload job.
  onJobProgress: (cb: (progress: JobProgress) => void) => on<JobProgress>("agent:job-progress", cb),

  // App metadata.
  appInfo: () => ipcRenderer.invoke("agent:app-info") as Promise<AppInfo>,
  configStatus: () => ipcRenderer.invoke("agent:config-status") as Promise<{ clerkConfigured: boolean }>,

  // Auto-update.
  checkUpdate: () => ipcRenderer.invoke("agent:check-update"),
  installUpdate: () => ipcRenderer.invoke("agent:install-update"),
  onUpdateEvent: (cb: (update: UpdateEvent) => void) => on<UpdateEvent>("agent:update-event", cb),

  // Floating widget + settings.
  getSettings: () => ipcRenderer.invoke("agent:get-settings") as Promise<AgentSettings>,
  setWidget: (patch: Partial<AgentSettings>) =>
    ipcRenderer.invoke("agent:set-widget", patch) as Promise<AgentSettings>,
  widgetOpenApp: () => ipcRenderer.invoke("agent:widget-open-app"),
  widgetHide: () => ipcRenderer.invoke("agent:widget-hide"),

  onConfigError: (cb: (msg: string) => void) => on<string>("agent:config-error", cb),
};

contextBridge.exposeInMainWorld("tandemAgent", api);

export type TandemAgentApi = typeof api;
