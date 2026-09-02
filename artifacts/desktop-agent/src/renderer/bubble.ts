// Clicking the bubble opens the main agent window (the widget is a shortcut
// into the app, Grammarly-style); the ✕ dismisses it until a video plays again.
//
// NOTE: keep this file free of import/export. It's loaded as a plain <script>
// tag (no bundler), so module syntax would make tsc emit a CommonJS wrapper
// that crashes the page — `exports` is undefined in the browser. All types
// come from the ambient globals.d.ts in this directory.
document.getElementById("core")!.addEventListener("click", () => {
  void window.tandemAgent.widgetOpenApp();
});

document.getElementById("close")!.addEventListener("click", () => {
  void window.tandemAgent.widgetHide();
});
