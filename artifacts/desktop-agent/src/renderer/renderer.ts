// NOTE: keep this file free of import/export. It's loaded as a plain <script>
// tag (no bundler), so module syntax would make tsc emit a CommonJS wrapper
// that crashes the page — `exports` is undefined in the browser. All types
// (AgentSettings, JobProgress, window.tandemAgent, …) come from the ambient
// globals.d.ts in this directory.

const $ = (id: string): HTMLElement => document.getElementById(id)!;

let signedIn = false;
let appInfo: AppInfo = { version: "0.0.0", platform: "unknown", packaged: false };
let updateReady = false;
let pendingSignInUrl = "";

// Never fail silently: surface renderer crashes into the note under the
// Account card so a broken build is obvious instead of looking like a dead UI.
window.addEventListener("error", (e) => {
  setAuthNote(`Renderer error: ${e.message}`, "err");
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as { message?: string } | undefined;
  setAuthNote(`Error: ${r?.message ?? String(r)}`, "err");
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function setAuthNote(line: string, cls = "status"): void {
  const el = $("auth-note");
  el.className = `auth-note ${cls}`;
  el.textContent = line;
  el.classList.toggle("hidden", !line);
}

async function refreshWho() {
  const who = await window.tandemAgent.whoami();
  signedIn = who.signedIn;
  const whoSpan = $("who");
  const accountLabel = who.email ?? who.userId ?? "";
  const authCard = $("auth-card");
  const avatar = $("auth-avatar");
  if (who.signedIn) {
    authCard.classList.add("signed-in");
    whoSpan.innerHTML = '<span class="auth-email">' + accountLabel + "</span>";
    avatar.textContent = (accountLabel.trim().charAt(0) || "T").toUpperCase();
    $("auth-sub").textContent = "Session active on this device";
    const footerAccount = $("footer-account");
    footerAccount.textContent = accountLabel;
    footerAccount.classList.remove("hidden");
    $("sign-in").textContent = "Switch account";
    $("sign-out").classList.remove("hidden");
    $("feature-cards").classList.remove("hidden");
  } else {
    authCard.classList.remove("signed-in");
    whoSpan.textContent = "Not signed in";
    avatar.textContent = "";
    $("auth-sub").textContent = "Sign up (or sign in) to unlock the project and widget cards.";
    $("footer-account").classList.add("hidden");
    $("sign-in").textContent = "Sign up";
    $("sign-out").classList.add("hidden");
    $("feature-cards").classList.add("hidden");
  }
}

// The sign-up link panel replaces the Account row while a sign-in is pending.
function openSigninPanel(url: string): void {
  pendingSignInUrl = url;
  $("auth-row").classList.add("hidden");
  $("signin-panel").classList.remove("hidden");
  const urlInput = $("signin-url") as HTMLInputElement;
  urlInput.value = url;
  $("copy-link").textContent = "Copy link";
  $("signin-wait").textContent = "Waiting for you to finish signing in…";
  setAuthNote("");
}

function closeSigninPanel(): void {
  pendingSignInUrl = "";
  $("signin-panel").classList.add("hidden");
  $("auth-row").classList.remove("hidden");
}

async function beginSignIn(): Promise<void> {
  try {
    const res = await window.tandemAgent.signInBegin();
    if (!res.ok) {
      setAuthNote(res.error ?? "Could not start sign-in.", "err");
      return;
    }
    openSigninPanel(res.url);
  } catch (err) {
    setAuthNote(`Sign-in failed: ${(err as Error).message}`, "err");
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
    setAuthNote(`Failed to load assets: ${(err as Error).message}`, "err");
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
  if (!signedIn) return;
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
  $("sign-in").addEventListener("click", () => void beginSignIn());

  // Browser sign-in link panel
  $("copy-link").addEventListener("click", async () => {
    if (!pendingSignInUrl) return;
    const res = await window.tandemAgent.copyText(pendingSignInUrl);
    if (res.ok) {
      const btn = $("copy-link");
      btn.textContent = "Copied ✓";
      setTimeout(() => {
        if (!pendingSignInUrl) btn.textContent = "Copy link";
      }, 1500);
    }
  });

  $("open-browser").addEventListener("click", async () => {
    if (!pendingSignInUrl) return;
    const res = await window.tandemAgent.openExternal(pendingSignInUrl);
    if (!res.ok) {
      setAuthNote(res.error ?? "Could not open the browser.", "err");
    }
  });

  $("cancel-signin").addEventListener("click", async () => {
    await window.tandemAgent.signInCancel();
    closeSigninPanel();
  });

  // Main process reports when the browser page finished (or the link expired).
  window.tandemAgent.onAuthEvent((evt) => {
    if (evt.type === "signed-in") {
      closeSigninPanel();
      setAuthNote("Signed in.", "ok");
      void refreshWho().then(() => loadProjects());
    } else if (evt.type === "expired") {
      closeSigninPanel();
      setAuthNote("The sign-in link expired. Click Sign up for a fresh one.", "err");
    } else if (evt.type === "error") {
      closeSigninPanel();
      setAuthNote(evt.error, "err");
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
    setAuthNote("Signed out.");
    setStatus("");
  });

  ($("project") as HTMLSelectElement).addEventListener("change", () => void loadAssets());
  $("pick").addEventListener("click", async () => {
    chosenFile = await window.tandemAgent.pickFile();
    $("file").textContent = chosenFile ?? "";
    if (chosenFile) {
      $("upload").removeAttribute("disabled");
    } else {
      $("upload").setAttribute("disabled", "true");
    }
  });
  $("upload").addEventListener("click", () => void runUpload());

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
      setAuthNote(
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
  window.tandemAgent.onConfigError((msg) => setAuthNote(msg, "err"));

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
  if (signedIn) {
    try {
      await loadProjects();
    } catch (err) {
      setAuthNote(`Failed to load projects: ${(err as Error).message}`, "err");
    }
  }

  window.tandemAgent.onJobProgress(handleProgress);
  window.tandemAgent.onUpdateEvent(handleUpdate);
}

void main().catch((err) => {
  setAuthNote(`Failed to start: ${(err as Error).message}`, "err");
});
