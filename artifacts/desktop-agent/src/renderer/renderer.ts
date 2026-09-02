declare global {
  interface Window {
    tandemAgent: {
      signIn: () => Promise<{ ok: boolean; email?: string }>;
      signOut: () => Promise<{ ok: boolean }>;
      whoami: () => Promise<{ signedIn: boolean; email?: string; userId?: string }>;
      listProjects: () => Promise<Array<{ id: string; name: string }>>;
      listAssets: (projectId: string) => Promise<Array<{ id: string; fileName: string }>>;
      pickFile: () => Promise<string | null>;
      uploadProxy: (opts: { projectId: string; assetId: string; localFile: string }) => Promise<{
        ok: boolean;
        storageKey?: string;
        sizeBytes?: number;
        error?: string;
      }>;
      checkUpdate: () => Promise<{ ok: boolean; reason?: string }>;
      installUpdate: () => Promise<{ ok: boolean }>;
      onConfigError: (cb: (msg: string) => void) => void;
    };
  }
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

let signedIn = false;

async function refreshWho() {
  const who = await window.tandemAgent.whoami();
  signedIn = who.signedIn;
  const whoSpan = $("who");
  if (who.signedIn) {
    whoSpan.innerHTML = '<span class="auth-email">' + (who.email ?? who.userId) + '</span>';
    $("sign-in").textContent = "Switch account";
    // Show sign-out and update buttons
    $("sign-out").classList.remove("hidden");
    $("update-btn").classList.remove("hidden");
    // Enable the workspace controls
    ($("project") as HTMLSelectElement).removeAttribute("disabled");
  } else {
    whoSpan.textContent = "Not signed in";
    $("sign-in").textContent = "Sign in";
    // Hide sign-out and update buttons
    $("sign-out").classList.add("hidden");
    $("update-btn").classList.add("hidden");
    // Disable workspace controls until signed in
    ($("project") as HTMLSelectElement).setAttribute("disabled", "true");
    ($("asset") as HTMLSelectElement).setAttribute("disabled", "true");
    $("upload").setAttribute("disabled", "true");
  }
}

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
    $("status").textContent = `Failed to load assets: ${(err as Error).message}`;
  }
}

let chosenFile: string | null = null;

function setStatus(line: string, cls = "status") {
  const el = $("status");
  el.className = cls;
  el.textContent = line;
}

async function runUpload() {
  const projectId = ($("project") as HTMLSelectElement).value;
  const assetId = ($("asset") as HTMLSelectElement).value;
  if (!projectId || !assetId || !chosenFile) {
    setStatus("Pick a project, asset, and raw file first.", "err");
    return;
  }
  setStatus("Generating proxy with FFmpeg…");
  $("upload").setAttribute("disabled", "true");
  try {
    const result = await window.tandemAgent.uploadProxy({ projectId, assetId, localFile: chosenFile });
    if (result.ok) {
      setStatus(
        `Done. Uploaded ${(result.sizeBytes ?? 0) / 1024 / 1024} MB proxy to R2 (${result.storageKey}).`,
        "ok",
      );
    } else {
      setStatus(result.error ?? "Upload failed.", "err");
    }
  } catch (err) {
    setStatus((err as Error).message, "err");
  } finally {
    $("upload").removeAttribute("disabled");
  }
}

function initListeners() {
  $("sign-in").addEventListener("click", async () => {
    const res = await window.tandemAgent.signIn();
    setStatus(res.ok ? "Signed in." : "Sign-in cancelled.", res.ok ? "ok" : "status");
    await refreshWho();
    if (res.ok) {
      await loadProjects();
    }
  });

  $("sign-out").addEventListener("click", async () => {
    await window.tandemAgent.signOut();
    chosenFile = null;
    $("file").textContent = "";
    // Clear project/asset selects
    const sel = $("project") as HTMLSelectElement;
    sel.length = 1;
    ($("asset") as HTMLSelectElement).length = 0;
    await refreshWho();
    setStatus("Signed out.", "status");
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
    const res = await window.tandemAgent.checkUpdate();
    if (!res.ok) {
      setStatus(res.reason ?? "Update check unavailable.", "status");
    } else {
      setStatus("Checking for updates…", "status");
    }
  });
}

async function main() {
  initListeners();
  window.tandemAgent.onConfigError((msg) => setStatus(msg, "err"));
  await refreshWho();
  try {
    await loadProjects();
  } catch {
    // stays empty until sign-in
  }
}

void main();

export {};