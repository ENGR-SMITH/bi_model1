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
let pendingLaunchProjectId: string | null = null;
let chosenFile: { path: string; name: string; sizeBytes: number } | null = null;
let uploading = false;

// ---------------------------------------------------------------------------
// Role gate — the roles the signed-in viewer holds on the selected project
// decide what may be uploaded. Mirrors Creator Den's role pages AND the API
// role gate, so a Video member can't drop images here and vice versa. The
// agent only surfaces uploads for VIDEO/AUDIO/THUMBNAIL/CAPTAIN/UPLOADER;
// SCRIPT members do their work in Creator Den and VIEWER is read-only.
// ---------------------------------------------------------------------------
type ProjectRolesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; roles: string[] }
  | { status: "error" };
let projectRoles: ProjectRolesState = { status: "idle" };

const ROLE_LABELS: Record<string, string> = {
  CAPTAIN: "Captain",
  VIDEO: "Video",
  AUDIO: "Audio",
  SCRIPT: "Script",
  THUMBNAIL: "Thumbnail",
  UPLOADER: "Uploader",
  VIEWER: "Viewer",
};

// The three uploadable file families and the extensions each role owns.
const VIDEO_EXTS = ["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg"];
const AUDIO_EXTS = ["wav", "mp3", "m4a", "aac", "flac", "ogg", "aif", "aiff", "opus"];
const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "avif"];
const ALL_MEDIA_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS, ...IMAGE_EXTS];

interface FileFamily {
  word: string; // e.g. "video" / "audio" / "image"
  exts: string[];
}

function rolesHeld(): string[] {
  return projectRoles.status === "ready" ? projectRoles.roles : [];
}

/** The uploadable file families the held roles own (empty = nothing). */
function fileFamiliesForRoles(roles: string[]): FileFamily[] {
  if (roles.some((role) => role === "CAPTAIN" || role === "UPLOADER")) {
    return [
      { word: "video", exts: VIDEO_EXTS },
      { word: "audio", exts: AUDIO_EXTS },
      { word: "image", exts: IMAGE_EXTS },
    ];
  }
  const families: FileFamily[] = [];
  if (roles.includes("VIDEO")) families.push({ word: "video", exts: VIDEO_EXTS });
  if (roles.includes("AUDIO")) families.push({ word: "audio", exts: AUDIO_EXTS });
  if (roles.includes("THUMBNAIL")) families.push({ word: "image", exts: IMAGE_EXTS });
  return families;
}

/** Extension (lowercase, no dot) of a path, or "" when there is none. */
function extOf(filePath: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filePath);
  return m ? m[1].toLowerCase() : "";
}

function allowedExtensions(): string[] {
  return fileFamiliesForRoles(rolesHeld()).flatMap((family) => family.exts);
}

function isFileAllowed(filePath: string): boolean {
  const allowed = allowedExtensions();
  return allowed.length > 0 && allowed.includes(extOf(filePath));
}

interface UploadPermission {
  canUpload: boolean;
  /** Short label, e.g. "video files". */
  summary: string;
  /** Full label with extensions, e.g. "video files (.mp4, .mov, …)". */
  detail: string;
  /** Copy shown instead when uploads are not available. */
  blockCopy: string;
}

/** Compact "video (.mp4, .mov, …)" label for a file family. */
function familyDetail(family: FileFamily): string {
  const shown = family.exts.slice(0, 4);
  const tail = family.exts.length > shown.length ? "…" : "";
  return `${family.word} files (.${shown.join(", .")}${tail})`;
}

function uploadPermission(): UploadPermission {
  const roles = rolesHeld();
  if (projectRoles.status !== "ready") {
    const blockCopy =
      projectRoles.status === "error"
        ? "Couldn't verify your roles on this project — uploads are paused. Re-pick the project to retry."
        : projectRoles.status === "loading"
          ? "Checking your roles on this project…"
          : "Pick a project first — the file types you can upload depend on the roles it gives you.";
    return { canUpload: false, summary: "", detail: "", blockCopy };
  }
  const families = fileFamiliesForRoles(roles);
  if (families.length > 0) {
    const joinWords = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}` : list[0]);
    return {
      canUpload: true,
      summary: joinWords(families.map((family) => `${family.word} files`)),
      detail: joinWords(families.map(familyDetail)),
      blockCopy: "",
    };
  }
  if (roles.includes("SCRIPT")) {
    return {
      canUpload: false,
      summary: "",
      detail: "",
      blockCopy: "Your Script role works in Creator Den — there are no uploads for you on this project here.",
    };
  }
  return {
    canUpload: false,
    summary: "",
    detail: "",
    blockCopy: "You're a Viewer on this project — the vault is read-only for you.",
  };
}

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
// Auth + profile
// ---------------------------------------------------------------------------
function setAuthNote(line: string, cls = "status"): void {
  const el = $("auth-note");
  el.className = `auth-note ${cls}`;
  el.textContent = line;
  el.classList.toggle("hidden", !line);
}

function setAvatar(label: string, imageUrl?: string | null): void {
  const el = $("auth-avatar");
  el.innerHTML = "";
  el.textContent = (label.trim().charAt(0) || "T").toUpperCase();
  if (imageUrl) {
    const img = document.createElement("img");
    img.className = "auth-avatar-img";
    img.src = imageUrl;
    img.alt = "";
    img.addEventListener("error", () => img.remove());
    el.appendChild(img);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type WhoAmI = {
  signedIn: boolean;
  email?: string | null;
  name?: string | null;
  imageUrl?: string | null;
  userId?: string;
};

async function refreshWho() {
  const who = (await window.tandemAgent.whoami()) as WhoAmI;
  signedIn = who.signedIn;
  const authCard = $("auth-card");
  const avatar = $("auth-avatar");
  const whoSpan = $("who");
  const accountLabel = (who.name || who.email || "").trim();

  if (who.signedIn) {
    authCard.classList.add("signed-in");
    whoSpan.textContent = accountLabel || who.userId || "Signed in";
    setAvatar(accountLabel || who.email || who.userId || "T", who.imageUrl);
    const sub = $("auth-sub");
    if (who.name && who.email) {
      sub.textContent = who.email;
    } else {
      sub.textContent = "Session active on this device";
    }
    $("footer-account").textContent = accountLabel;
    $("footer-account").classList.remove("hidden");
    $("sign-in").textContent = "Switch account";
    $("sign-out").classList.remove("hidden");
    $("feature-cards").classList.remove("hidden");
  } else {
    authCard.classList.remove("signed-in");
    whoSpan.textContent = "Not signed in";
    setAvatar("", null);
    avatar.textContent = "";
    $("auth-sub").textContent = "Sign up (or sign in) to unlock the workspace.";
    $("footer-account").classList.add("hidden");
    $("sign-in").textContent = "Sign up";
    $("sign-out").classList.add("hidden");
    $("feature-cards").classList.add("hidden");
    projectRoles = { status: "idle" };
  }
  renderRoles();
  updateUploadEnabled();
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

// Same as beginSignIn but opens the link in the browser automatically — used
// when the session token went stale mid-use. The browser already holds the
// real Clerk session, so the page completes on its own and the app gets a
// fresh token without the user doing anything beyond letting the tab open.
async function beginAutoReSignIn(): Promise<void> {
  try {
    const res = await window.tandemAgent.signInBegin();
    if (!res.ok) {
      setAuthNote(res.error ?? "Could not start sign-in.", "err");
      return;
    }
    openSigninPanel(res.url);
    const opened = await window.tandemAgent.openExternal(res.url);
    if (!opened.ok) {
      setAuthNote("Your fresh sign-in link is ready — click Open in browser.", "err");
    }
  } catch (err) {
    setAuthNote(`Sign-in failed: ${(err as Error).message}`, "err");
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
async function loadProjects() {
  const sel = $("project") as HTMLSelectElement;
  const projects = await window.tandemAgent.listProjects();
  sel.length = 1;
  // Repopulating the list wipes any previous selection — clear the role gate
  // state so nothing stale leaks into the next project pick.
  projectRoles = { status: "idle" };
  chosenFile = null;
  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  if (pendingLaunchProjectId) preselectProject(pendingLaunchProjectId);
  renderRoles();
  setFileChip();
}

function preselectProject(projectId: string): void {
  const sel = $("project") as HTMLSelectElement;
  if (sel.querySelector(`option[value="${projectId}"]`)) {
    sel.value = projectId;
    pendingLaunchProjectId = null;
    void loadRolesFor(projectId);
  } else {
    // The project list may not be loaded yet — apply it once it populates.
    pendingLaunchProjectId = projectId;
  }
  updateUploadEnabled();
}

// ---------------------------------------------------------------------------
// Role display + gating for the selected project
// ---------------------------------------------------------------------------

function renderRoles(): void {
  const row = $("roles-row");
  const chips = $("role-chips");
  const note = $("roles-note");
  const projectId = ($("project") as HTMLSelectElement).value;
  if (!signedIn || !projectId) {
    row.classList.add("hidden");
    chips.innerHTML = "";
    note.textContent = "";
    updateUploadEnabled();
    return;
  }
  row.classList.remove("hidden");
  chips.innerHTML = "";

  if (projectRoles.status === "loading") {
    note.className = "roles-note";
    note.textContent = "Checking your roles…";
    updateUploadEnabled();
    return;
  }
  if (projectRoles.status === "error") {
    note.className = "roles-note is-blocked";
    note.textContent = "Couldn't verify your roles — uploads are paused. Re-pick the project to retry.";
    updateUploadEnabled();
    return;
  }

  const roles = rolesHeld();
  for (const role of roles) {
    const chip = document.createElement("span");
    chip.className = `role-chip role-chip-${role.toLowerCase()}`;
    chip.textContent = ROLE_LABELS[role] ?? role;
    chips.appendChild(chip);
  }
  const perm = uploadPermission();
  note.className = perm.canUpload ? "roles-note" : "roles-note is-blocked";
  note.textContent = perm.canUpload ? `Can upload: ${perm.summary} — drop them in below.` : perm.blockCopy;
  updateUploadEnabled();
}

async function loadRolesFor(projectId: string): Promise<void> {
  if (!projectId || !signedIn) {
    projectRoles = { status: "idle" };
    renderRoles();
    return;
  }
  projectRoles = { status: "loading" };
  renderRoles();
  try {
    const res = await window.tandemAgent.projectRoles(projectId);
    projectRoles = { status: "ready", roles: Array.isArray(res?.myRoles) ? res.myRoles : [] };
  } catch (err) {
    projectRoles = { status: "error" };
  }
  // A file chosen for the previous project may not fit this one's roles.
  if (chosenFile && !isFileAllowed(chosenFile.path)) {
    chosenFile = null;
    setStatus("", "status");
  }
  renderRoles();
  setFileChip();
}

// ---------------------------------------------------------------------------
// Source file (drag & drop / choose)
// ---------------------------------------------------------------------------
function setFileChip(): void {
  const dz = $("dropzone");
  const title = $("dz-title");
  const sub = $("dz-sub");
  const change = $("dz-change");
  if (chosenFile) {
    dz.classList.add("has-file");
    title.textContent = chosenFile.name;
    sub.textContent = formatBytes(chosenFile.sizeBytes);
    change.style.display = "";
    dz.classList.toggle("is-disabled", false);
  } else {
    const perm = uploadPermission();
    dz.classList.remove("has-file");
    title.textContent = "Drag & drop your file here";
    if (perm.canUpload) {
      sub.innerHTML = `or <b>click to choose</b> — ${perm.detail} from your PC`;
      dz.classList.remove("is-disabled");
    } else {
      sub.innerHTML = perm.blockCopy;
      dz.classList.add("is-disabled");
    }
    change.style.display = "none";
  }
  updateUploadEnabled();
}

function wrongFileTypeMessage(filePath: string): string {
  const perm = uploadPermission();
  const ext = extOf(filePath);
  return `That's a .${ext || "?"} file — your roles here only allow ${perm.detail}.`;
}

async function adoptPath(filePath: string | null | undefined): Promise<void> {
  if (!filePath) return;
  const perm = uploadPermission();
  if (!perm.canUpload) {
    chosenFile = null;
    setStatus(perm.blockCopy, "err");
    setFileChip();
    return;
  }
  if (!isFileAllowed(filePath)) {
    chosenFile = null;
    setStatus(wrongFileTypeMessage(filePath), "err");
    setFileChip();
    return;
  }
  const info = await window.tandemAgent.fileInfo(filePath);
  if (!info) {
    setStatus("That file could not be read — pick another one.", "err");
    return;
  }
  chosenFile = { path: info.path, name: info.name, sizeBytes: info.sizeBytes };
  setStatus("");
  setFileChip();
}

function updateUploadEnabled(): void {
  const btn = $("upload") as HTMLButtonElement;
  const projectReady = ($("project") as HTMLSelectElement).value !== "";
  const perm = uploadPermission();
  const ready = signedIn && projectReady && projectRoles.status === "ready" && perm.canUpload && Boolean(chosenFile) && !uploading;
  if (ready) btn.removeAttribute("disabled");
  else btn.setAttribute("disabled", "true");
}

function wireDropzone(): void {
  const dz = $("dropzone");

  const openPicker = () => {
    const perm = uploadPermission();
    if (!perm.canUpload) {
      chosenFile = null;
      setStatus(perm.blockCopy, "err");
      setFileChip();
      return;
    }
    // The OS picker only offers the extensions this member's roles allow.
    void window.tandemAgent.pickFile(allowedExtensions()).then((p) => adoptPath(p));
  };
  dz.addEventListener("click", openPicker);
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  ["dragenter", "dragover"].forEach((name) =>
    dz.addEventListener(name, (e) => {
      e.preventDefault();
      if (uploadPermission().canUpload) dz.classList.add("drag");
    }),
  );
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("drag");
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    // Electron: resolve the dropped File back to its real absolute path.
    const filePath = window.tandemAgent.droppedFilePath(file);
    void adoptPath(filePath || null);
  });
}

// ---------------------------------------------------------------------------
// Vault upload + live progress
// ---------------------------------------------------------------------------
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
    label.textContent = p.percent >= 0 ? `Encoding 720p proxy… ${p.percent}%` : "Encoding 720p proxy…";
  } else {
    const mb = (n?: number) => (n === undefined ? "—" : (n / 1048576).toFixed(1));
    const pct = p.percent >= 0 ? ` (${p.percent}%)` : "";
    label.textContent = `Uploading to the vault… ${mb(p.sentBytes)} / ${mb(p.totalBytes)} MB${pct}`;
  }

  if (p.percent < 0) {
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
  if (!signedIn || uploading) return;
  const perm = uploadPermission();
  if (!perm.canUpload) {
    setStatus(perm.blockCopy, "err");
    return;
  }
  const projectId = ($("project") as HTMLSelectElement).value;
  if (!projectId || !chosenFile) {
    setStatus("Pick a project and a source file first.", "err");
    return;
  }
  uploading = true;
  updateUploadEnabled();
  resetProgress();
  setStatus(`Uploading “${chosenFile.name}” to the vault…`);
  const btn = $("upload") as HTMLButtonElement;
  btn.textContent = "Uploading…";
  try {
    const result = await window.tandemAgent.uploadRaw({ projectId, localFile: chosenFile.path });
    const fill = $("barfill");
    fill.classList.remove("indeterminate");
    fill.style.width = "100%";
    setStatus(
      `“${result.fileName}” is in the vault — its proxy and preview are being prepared in the background.`,
      "ok",
    );
  } catch (err) {
    setStatus((err as Error).message, "err");
    resetProgress();
  } finally {
    uploading = false;
    btn.textContent = "Upload to project vault";
    updateUploadEnabled();
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
  window.tandemAgent.onAuthEvent(async (evt) => {
    if (evt.type === "signed-in") {
      closeSigninPanel();
      setAuthNote("Signed in.", "ok");
      void refreshWho().then(() => loadProjects());
    } else if (evt.type === "expired") {
      closeSigninPanel();
      setAuthNote("The sign-in link expired. Click Sign up for a fresh one.", "err");
    } else if (evt.type === "session-expired") {
      // The API rejected our token (401) — the Clerk session token the agent
      // captures at sign-in is short-lived (~1 minute by design), so drop the
      // stale session and start a fresh sign-in automatically. The user's
      // browser still holds the real Clerk session, so the new link completes
      // in one click without re-entering credentials.
      chosenFile = null;
      setFileChip();
      uploading = false;
      setStatus("", "status");
      setAuthNote("Your sign-in expired — getting you a fresh one…", "err");
      await refreshWho();
      if (!signedIn) await beginAutoReSignIn();
    } else if (evt.type === "error") {
      closeSigninPanel();
      setAuthNote(evt.error, "err");
    }
  });

  $("sign-out").addEventListener("click", async () => {
    await window.tandemAgent.signOut();
    chosenFile = null;
    setFileChip();
    setStatus("");
    await refreshWho();
    setAuthNote("Signed out.");
  });

  // Picking a different project re-checks the viewer's roles — the uploadable
  // file types follow the roles that project gives them.
  ($("project") as HTMLSelectElement).addEventListener("change", () => {
    const pid = ($("project") as HTMLSelectElement).value;
    if (pid) {
      void loadRolesFor(pid);
    } else {
      projectRoles = { status: "idle" };
      chosenFile = null;
      setFileChip();
      renderRoles();
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
  wireDropzone();
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

  // Creator Den opened the app for an upload — preselect the project and tell
  // the user the hand-off worked.
  window.tandemAgent.onLaunchContext((ctx) => {
    if (ctx.projectId) preselectProject(ctx.projectId);
    setStatus(
      ctx.projectId
        ? "Opened from Creator Den — drop your file and upload."
        : "Opened from Creator Den — pick a project, drop your file, and upload.",
      "status",
    );
  });
}

void main().catch((err) => {
  setAuthNote(`Failed to start: ${(err as Error).message}`, "err");
});