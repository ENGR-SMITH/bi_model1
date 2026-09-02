import { contextBridge, ipcRenderer } from "electron";

const api = {
  signIn: () => ipcRenderer.invoke("agent:sign-in"),
  signOut: () => ipcRenderer.invoke("agent:sign-out"),
  whoami: () => ipcRenderer.invoke("agent:whoami"),
  listProjects: () => ipcRenderer.invoke("agent:list-projects"),
  listAssets: (projectId: string) => ipcRenderer.invoke("agent:list-assets", projectId),
  pickFile: () => ipcRenderer.invoke("agent:pick-file"),
  uploadProxy: (opts: { projectId: string; assetId: string; localFile: string }) =>
    ipcRenderer.invoke("agent:upload-proxy", opts),
  checkUpdate: () => ipcRenderer.invoke("agent:check-update"),
  installUpdate: () => ipcRenderer.invoke("agent:install-update"),
  onConfigError: (cb: (msg: string) => void) =>
    ipcRenderer.on("agent:config-error", (_e, msg: string) => cb(msg)),
};

contextBridge.exposeInMainWorld("tandemAgent", api);

export type TandemAgentApi = typeof api;