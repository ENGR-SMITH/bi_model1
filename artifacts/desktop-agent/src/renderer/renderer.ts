import type { TandemAgentApi } from "../preload";
import type { AgentSettings, AppInfo, JobProgress, UpdateEvent } from "../shared/types";

declare global {
  interface Window {
    tandemAgent: TandemAgentApi;
  }
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

let signedIn = false;
let appInfo: AppInfo = { version: "0.0.0", platform: "unknown", packaged: false };
let updateReady = false;

// Never fail silently: surface renderer crashes into the status line so a
// broken build is obvious instead of looking like a dead UI.
window.addEventListener("error", (e) => {
  setStatus(`Renderer error: ${e.message}`, "err");
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as { message?: string } | undefined;
  setStatus(`Error: ${r?.message ?? String(r)}`, "err");
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function refreshWho() {
  const who = await window.tandemAgent.whoami();
  signedIn = who.signedIn;
  const whoSpan = $("who");
  if (who.signedIn) {
    whoSpan.innerHTML = '<span class="auth-email">' + (who.email ?? who.userId) + "</span>";
    $("sign-in").textContent = "Switch account";
    $("sign-out").classList.remove("hidden");
    ($("project") as HTMLSelectElement).removeAttribute("disabled");
    ($("asset") as HTMLSelectElement).removeAttribute("disabled");
  } else {
    whoSpan.textContent = "Not signed in";
    $("sign-in").textContent = "Sign in";
    $("sign-out").classList.add("hidden");
    ($("project") as HTMLSelectElement).setAttribute("disabled", "true");
    ($("asset") as HTMLSelectElement).setAttribute("disabled", "true");
    $("upload").setAttribute("disabled", "true");
  }
}

// ---------------------------------------------------------------------------
// Projects / assets
// ---------------------------------------------------------------------------
async function loadProjects() {
  const sel = $("project") as HTMLSelectElement;
  const projects = await window.tandemAgent.listProjects();
  sel.length = 1;
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

async function loadAssets() {
  const projectId = ($("project") as HTMLSelectElement).value;
  const sel = $("asset") as HTMLSelectElement;
  sel.length = 0;
  if (!projectId) return;
  try {
    const assets = await window.tandemAgent.listAssets(projectId);
    for (const a of assets) {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = a.fileName;
      sel.appendChild(opt);
    }
  } catch (err) {
    setStatus(`Failed to load assets: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Proxy job + live progress
// ---------------------------------------------------------------------------
let chosenFile: string | null = null;

function setStatus(line: string, cls = "status") {
  const el = $("status");
  el.className = cls;
  el.textContent = line;
}

function handleProgress(p: JobProgress) {
  const fill = $("barfill");
  const label = $("progress-label");
  label.classList.remove("hidden");

  if (p.phase === "proxy") {
    label.textContent =
      p.percent >= 0 ? `Encoding 720p proxy… ${p.percent}%` : "Encoding 720p proxy…";
  } else {
    const mb = (n?: number) => (n === undefined ? "—" : (n / 1048576).toFixed(1));
    const pct = p.percent >= 0 ? ` (${p.percent}%)` : "";
    label.textContent = `Uploading to R2… ${mb(p.sentBytes)} / ${mb(p.totalBytes)} MB${pct}`;
  }

  if (p.percent < 0) {
    // Can't measure yet — animate an indeterminate shimmer.
    fill.classList.add("indeterminate");
    fill.style.width = "0";
  } else {
    fill.classList.remove("indeterminate");
    fill.style.width = p.percent + "%";
  }
}

function resetProgress() {
  const fill = $("barfill");
  fill.classList.remove("indeterminate");
  fill.style.width = "0";
  $("progress-label").classList.add("hidden");
}

async function runUpload() {
  const projectId = ($("project") as HTMLSelectElement).value;
  const assetId = ($("asset") as HTMLSelectElement).value;
  if (!projectId || !assetId || !chosenFile) {
    setStatus("Pick a project, asset, and raw file first.", "err");
    return;
  }
  resetProgress();
  setStatus("Generating proxy with FFmpeg…");
  $("upload").setAttribute("disabled", "true");
  try {
    const result = await window.tandemAgent.uploadProxy({ projectId, assetId, localFile: chosenFile });
    if (result.ok) {
      setStatus(
        `Done. Uploaded ${(result.sizeBytes ?? 0) / 1024 / 1024} MB proxy to R2 (${result.storageKey}).`,
        "ok",
      );
      const fill = $("barfill");
      fill.classList.remove("indeterminate");
      fill.style.width = "100%";
    } else {
      setStatus(result.error ?? "Upload failed.", "err");
      resetProgress();
    }
  } catch (err) {
    setStatus((err as Error).message, "err");
    resetProgress();
  } finally {
    $("upload").removeAttribute("disabled");
  }
}

// ---------------------------------------------------------------------------
// Auto-update UI
// ---------------------------------------------------------------------------
function handleUpdate(u: UpdateEvent) {
  const status = $("update-status");
  const btn = $("update-btn");
  status.className = "status";
  switch (u.type) {
    case "checking":
      status.textContent = "Checking for updates…";
      break;
    case "available":
      status.textContent = `Update v${u.version} available — downloading…`;
      break;
    case "downloading":
      status.textContent = `Downloading update… ${u.percent ?? 0}%`;
      break;
    case "downloaded":
      updateReady = true;
      status.className = "ok";
      status.textContent = `Update v${u.version} downloaded. Restart to install it.`;
      btn.textContent = "Restart & update";
      break;
    case "not-available":
      status.textContent = "You're on the latest version.";
      break;
    case "error":
      status.className = "err";
      status.textContent = `Update check failed: ${u.error ?? "unknown error"}`;
      if (/enotfound|getaddrinfo|404/i.test(u.error ?? "")) {
        status.textContent += " — point TANDEM_UPDATE_URL at your release feed (see README).";
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Floating widget settings
// ---------------------------------------------------------------------------
async function syncWidgetSettings(s: AgentSettings) {
  const enable = $("widget-enable") as HTMLInputElement;
  const auto = $("widget-auto") as HTMLInputElement;
  const windows = appInfo.platform === "win32";
  const note = $("platform-note");

  note.textContent = windows
    ? "Requires Windows."
    : "Only available on Windows — on this platform the agent runs as a regular window.";

  enable.checked = s.widgetEnabled && windows;
  auto.checked = s.widgetAutoShow;
  enable.disabled = !windows;
  auto.disabled = !windows || !s.widgetEnabled;
}

async function loadWidgetSettings() {
  try {
    await syncWidgetSettings(await window.tandemAgent.getSettings());
  } catch {
    // preload not ready — settings card stays inert
  }
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------
function initListeners() {
  $("sign-in").addEventListener("click", async () => {
    try {
      const res = await window.tandemAgent.signIn();
      if (!res.ok) {
        setStatus(res.error ?? "Sign-in cancelled.", "err");
        return;
      }
      setStatus("Signed in.", "ok");
      await refreshWho();
      await loadProjects();
    } catch (err) {
      setStatus(`Sign-in failed: ${(err as Error).message}`, "err");
    }
  });

  $("sign-out").addEventListener("click", async () => {
    await window.tandemAgent.signOut();
    chosenFile = null;
    $("file").textContent = "";
    const sel = $("project") as HTMLSelectElement;
    sel.length = 1;
    ($("asset") as HTMLSelectElement).length = 0;
    await refreshWho();
    setStatus("Signed out.");
  });

  ($("project") as HTMLSelectElement).addEventListener("change", loadAssets);
  $("pick").addEventListener("click", async () => {
    chosenFile = await window.tandemAgent.pickFile();
    $("file").textContent = chosenFile ?? "";
    if (chosenFile) {
      $("upload").removeAttribute("disabled");
    }
  });
  $("upload").addEventListener("click", runUpload);

  // Auto-update
  $("update-btn").addEventListener("click", async () => {
    if (updateReady) {
      await window.tandemAgent.installUpdate();
      return;
    }
    const res = await window.tandemAgent.checkUpdate();
    if (!res.ok) {
      const status = $("update-status");
      status.className = "status";
      status.textContent = res.reason ?? "Update check unavailable.";
    }
  });

  // Widget toggles
  ($("widget-enable") as HTMLInputElement).addEventListener("change", async () => {
    const enabled = ($("widget-enable") as HTMLInputElement).checked;
    const s = await window.tandemAgent.setWidget({ widgetEnabled: enabled });
    await syncWidgetSettings(s);
  });
  ($("widget-auto") as HTMLInputElement).addEventListener("change", async () => {
    const autoShow = ($("widget-auto") as HTMLInputElement).checked;
    const s = await window.tandemAgent.setWidget({ widgetAutoShow: autoShow });
    await syncWidgetSettings(s);
  });
}

// ---------------------------------------------------------------------------
// Config warning (pull-based, unlike the one-shot agent:config-error push)
// ---------------------------------------------------------------------------
async function checkConfig() {
  try {
    const st = await window.tandemAgent.configStatus();
    if (!st.clerkConfigured) {
      setStatus(
        "Clerk publishable key is not configured. Create tandem-agent.json next to the app " +
          "with { \"clerkPublishableKey\": \"pk_test_...\" } (or set TANDEM_CLERK_PUBLISHABLE_KEY) " +
          "and relaunch before signing in.",
        "err",
      );
    }
  } catch {
    // preload not available — the global error handler will surface it
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  initListeners();
  window.tandemAgent.onConfigError((msg) => setStatus(msg, "err"));

  try {
    appInfo = await window.tandemAgent.appInfo();
  } catch {
    // keep defaults
  }
  const version = $("version");
  if (version) version.textContent = appInfo.version;
  await loadWidgetSettings();

  await checkConfig();
  await refreshWho();
  try {
    await loadProjects();
  } catch {
    // stays empty until sign-in
  }

  window.tandemAgent.onJobProgress(handleProgress);
  window.tandemAgent.onUpdateEvent(handleUpdate);
}

void main().catch((err) => {
  setStatus(`Failed to start: ${(err as Error).message}`, "err");
});

export {};
