// Ambient types for the renderer "pages" (index.html / bubble.html).
//
// These pages load their scripts as plain <script> tags with nodeIntegration
// off, so there is no bundler and no module loader. If a renderer source file
// contained import/export, tsc would wrap the emitted JS in a CommonJS shim
// (Object.defineProperty(exports, …)) and the page would crash on load —
// `exports` doesn't exist in a browser context, so every event listener would
// silently never attach and the window would look dead.
//
// To keep the emitted files as plain scripts, the renderer sources must stay
// import/export-free. Every type they need is declared here on the global
// scope instead; the import() type queries below are erased at compile time.
interface Window {
  tandemAgent: import("../preload").TandemAgentApi;
}

type AgentSettings = import("../shared/types").AgentSettings;
type AppInfo = import("../shared/types").AppInfo;
type JobProgress = import("../shared/types").JobProgress;
type UpdateEvent = import("../shared/types").UpdateEvent;
