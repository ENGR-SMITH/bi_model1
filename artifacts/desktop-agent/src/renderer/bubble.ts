import type { TandemAgentApi } from "../preload";

declare global {
  interface Window {
    tandemAgent: TandemAgentApi;
  }
}

// Clicking the bubble opens the main agent window (the widget is a shortcut
// into the app, Grammarly-style); the ✕ dismisses it until a video plays again.
document.getElementById("core")!.addEventListener("click", () => {
  void window.tandemAgent.widgetOpenApp();
});

document.getElementById("close")!.addEventListener("click", () => {
  void window.tandemAgent.widgetHide();
});

export {};
