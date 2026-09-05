# Tandem Desktop Agent

A small Windows/macOS desktop app that hands files **from your PC to the
Captain for review** — drag a raw file in (or click to choose it), write a note
describing it, and both stream to your Tandem API as a **review submission**.
The file stays private (a pending entry on the Captain's review desk) until the
Captain approves it — only then does it land in the project vault and start the
normal pipeline (hashing, proxy, preview). No asset dropdown, no size cap: the
agent exists because a browser tab is the wrong tool for multi-GB footage, and
the web app caps uploads at 500 MB.

It is the "large-file / desktop agent" half of the Cloudflare R2 integration.
The browser handles files under 500 MB; anything bigger (and, for lower CPU
load, typical media too) is best pushed by this agent.

## How it works

```
Your machine                 Your API server                     Captain's review desk
   │ drop/choose raw file           │
   │ POST …/projects/:id/assets ───▶│  checks auth (Clerk JWT) + roles,
   │  (multipart + note, review=true)│  holds the file as PENDING_REVIEW,
   │                                │  adds a submission to the review queue
   │ ◀── submission id ─────────────│  ──▶ approve ──▶ file enters the vault
   │                                │                 and runs the pipeline
   │                                │  ──▶ reject ───▶ file deleted, sent back
```

The agent signs in with **Clerk** through your **system browser**: it hands you a
one-time sign-up link, you open it in your normal browser, and once you finish
the app signs you in automatically — showing your account **name and avatar** in
the app. It reuses your existing Tandem account and talks to the same API the
web apps use. If your session token ever goes stale (Clerk tokens are
short-lived by design), the agent signs itself back in automatically.

## Prerequisites on the user's machine

- Nothing — the file streams from disk to the API with no local encoding step
  and no extra installs.

## Configuration

Create `tandem-agent.json` next to the app (or `~/.tandem-agent/config.json`),
or set environment variables:

```json
{
  "apiBaseUrl": "https://your-api.example.com",
  "clerkPublishableKey": "pk_test_...",
  "updateUrl": "https://media.example.com/desktop-agent"
}
```

| Config / env            | Meaning                                |
| ----------------------- | -------------------------------------- |
| `TANDEM_API_URL`        | API base, no trailing slash. Default `http://localhost:3000` |
| `TANDEM_CLERK_PUBLISHABLE_KEY` | Your Clerk **publishable** key. |
| `TANDEM_AGENT_WORK_DIR` | Temp dir for staged uploads. |
| `TANDEM_UPDATE_URL` / `updateUrl` | Auto-update feed base URL (`latest.yml` / `latest-mac.yml` location). Overrides the publish URL baked in at build time. |

> Use the **publishable** key (safe to ship in a desktop app — it's public).
> Never embed the **secret** key.

## Running in development

```bash
pnpm --filter @workspace/desktop-agent run dev
```

## Building the installer

Production differs per OS — build the installer **on that OS** (Windows exe
must be built on Windows or in a Windows CI). electron-builder cross-builds
badly for Windows; a GitHub Actions Windows runner is the simplest path.

### Windows (.exe)

On a Windows machine (or a Windows CI runner), from the repo root:

```bash
pnpm --filter @workspace/desktop-agent install
pnpm --filter @workspace/desktop-agent run build
```

Output installer: `artifacts/desktop-agent/dist-bundle/Tandem Desktop Agent Setup 0.0.1.exe`.

### macOS (.dmg)

On a Mac:

```bash
pnpm --filter @workspace/desktop-agent install
pnpm --filter @workspace/desktop-agent run build
```

Output: `artifacts/desktop-agent/dist-bundle/Tandem-Desktop-Agent-0.0.1.dmg`.
(For notarization you'll add an Apple Developer cert + `notarize` config.)

### CI (GitHub Actions, cross-OS without a local machine)

The included workflow builds the Windows installer on `windows-latest` and the
macOS dmg on `macos-latest`, uploads both as workflow artifacts, **and pushes
the installer to your Cloudflare R2 bucket** so the in-app button can link to
it directly ($0 egress).

Set these GitHub secrets: `CF_ACCOUNT_ID`, `CF_R2_ACCESS_KEY`, `CF_R2_SECRET_KEY`
(and optionally the repo variable `R2_BUCKET`, default `tandem-media`).

The installer lands at:
`https://<public-domain>/desktop-agent/tandem-desktop-agent-latest.<exe|dmg>`

## In-app download button

The Creator Den vault and the Tandem content-creators doorway show a
**"Desktop agent for large files"** link whenever `VITE_AGENT_DOWNLOAD_URL` is set
in the app's `.env` (copy it from the root `.env.example`). Point it at the R2
public URL above (or a GitHub Release URL) and the button appears for users.

## Launching from Creator Den (control server + deep link)

Every upload section in Creator Den also offers **"Desktop agent"** as a second
upload method, so users pick between the browser and the agent any time. For
that hand-off the agent runs a tiny loopback control server (bound to
`127.0.0.1:<port>`, default `41737`, override with `TANDEM_AGENT_CONTROL_PORT`
— the web app must match with `VITE_AGENT_CONTROL_PORT`):

- `GET /health` — the web app detects whether the agent is running.
- `POST /launch` — receives `{ projectId, returnUrl }`, focuses the window and
  preselects the project.
- `GET /job-status` — the web app polls this; when the upload job is `done` it
  refreshes the page, and the agent reopens the `returnUrl` so the user lands
  back on Creator Den automatically.

The installer registers the `tandem-agent://` URL scheme (build-time
`protocols` entry + runtime `setAsDefaultProtocolClient`), so a deep link
(`tandem-agent://launch?projectId=…&returnUrl=…`) starts an installed-but-idle
agent too. The agent only ever opens `returnUrl` values that point back at the
configured `TANDEM_WEB_URL` origin.

## Auto-update

The installed app checks for updates on launch (and via the **Check for updates**
button in the **Agent updates** card on the right) and downloads them in the
background; when a new version is ready the button becomes **Restart & update**. Releases are published by the
`build-desktop-agent` CI workflow, which uploads the installer **plus the
`latest*.yml` feed files and blockmaps** next to it — point `TANDEM_UPDATE_URL`
(or the build-time `build.publish.url`) at that public directory.

Update checks only run in the packaged app (`app.isPackaged`) because
`electron-updater` needs the `app-update.yml` that electron-builder bakes into
an installer build; running from source shows "Update checks only work in the
installed app." instead.

## Floating video widget (Windows)

The agent can run a Grammarly-style floating bubble: a small always-on-top,
draggable red circle that lives over whatever you're doing and opens the agent
when clicked. Enable it from the **Floating widget** card (right column of the
app) with the single **Widget** switch — the bubble appears **immediately** (no
restart needed):

- **Widget** — one switch controls the whole feature: when on, the app keeps
  running in the tray after you close its window (click the tray icon to
  reopen, or **Quit Tandem Agent** from its menu), and it **auto-shows while a
  video plays** — when Windows reports a video playing in a browser or media
  player (via the OS media-session feed), the bubble appears and disappears a
  few seconds after playback stops. Detection polls every ~3 s and only matches
  apps it recognizes as video-capable, so plain music apps don't summon it.
  Turning the switch off disables the bubble and auto-show together.
- **Fallbacks** — press `Ctrl+Alt+T` or use the tray menu to show/hide the
  bubble anytime. Drag it anywhere; its position is remembered.

Clicking the bubble opens the agent window. Windows-only for now; on macOS/Linux
the toggle is disabled and the app runs as a normal window.

## Signing in

Sign-in runs in your own browser (Google OAuth + passkeys need it), device-flow
style:

1. Launch the app → click **Sign up**. The Account card shows a **sign-up link**
   (plus **Copy link** and **Open in browser** buttons).
2. Open the link in your normal browser on this machine — it opens the Tandem
   sign-up page (powered by the same Clerk instance as the web apps). Sign up,
   or switch to **Sign in** inside the page if you already have an account.
3. When you finish, the agent **raises its own window and signs you in
   automatically** — your account **name, email, and avatar** appear in the
   Account card (the page also nudges the app via the `tandem-agent://` deep
   link as a backup). The link is one-time: it's tied to the sign-in you
   started and expires after 10 minutes.

Until you're signed in, only the Account card is visible — the workspace,
source file, upload, and widget cards stay hidden. Once signed in:

1. Pick the **channel** you're uploading into, then the **project** (Workspace
   card). The Project list is scoped to the selected channel exactly like
   Creator Den (editors only see the projects they're members of there);
   **All channels** shows every project you can reach, including legacy
   unlinked ones. The card then shows **your roles on that project**
   (e.g. Video · Audio) and what those roles may upload.
2. **Drag & drop** the file into the Source file card — or click it to choose
   from disk. The card shows the file's name and size.
3. (Optional) Write a **note to the Captain** describing the file — what it is
   and what it is for.
4. Click **Submit for review** — the file and your note stream from your PC
   with a live progress bar, and land as a pending entry on the Captain's
   review desk in Creator Den. Nothing reaches the vault until the Captain
   clicks **Accept** (the file then enters the vault and its proxy/preview are
   built in the background); a **Reject** deletes the file and sends it back
   with the Captain's improvement note.

**The Captain adds directly.** When the signed-in viewer *is* the Captain of
the selected project, the note field and review hand-off disappear and the
button becomes **Upload to vault**: the file goes straight in with no
self-approval (the server applies the same rule to every client).

**Uploads are role-gated.** The file types you can submit follow the roles you
were assigned on the selected project (the same rule the Creator Den role
pages use): VIDEO members can add footage, AUDIO members sound, THUMBNAIL
members images, and the Captain/Uploader can add any of them. A member with
several roles may upload every kind those roles own. The picker only offers
your roles' file types, anything else dropped in is rejected with an
explanation, and the API server enforces the same gate on every submission — so
a Video member can't push images into the vault from any client. SCRIPT and
VIEWER members are read-only here: scripts live in Creator Den, and a Viewer
has no upload rights.

> Signing out only signs the **agent** out. The Clerk session lives in your
> browser, so signing in again completes instantly with the account active
> there (it reuses whichever Tandem account that browser is signed into).

## Notes & current limits

- The video widget's auto-show uses the Windows media-session feed, so it only
  knows about apps that publish to it (browsers, VLC, Movies & TV, …).
  Detection is best-effort and polls every ~3 s; use `Ctrl+Alt+T` / the tray
  if it misses something.
- The agent submits files **for review** (the same `POST …/assets` multipart
  endpoint the browser uses, with `review=true` and a note) — the Captain's
  approval is what moves a file into the vault, so nothing bypasses the review
  desk. The web Script desk's direct uploads (raw audio/video for
  transcription) are the one exception, and stay direct by design.
- Uploads are checked against the project roles the signed-in viewer holds
  (server-side gate in the assets route, mirrored by the agent's picker and
  drop-zone filters). A SCRIPT member may still add raw audio/video to the
  vault through the web Script desk for transcription.
- The Clerk session token is handed back to the agent over a loopback
  `127.0.0.1` server the app starts per attempt; the link carries a random
  per-attempt `state` so only that sign-in can complete. Clerk session tokens
  are intentionally short-lived (~60 seconds), so when the API answers 401 the
  agent drops the stale session and automatically starts a fresh sign-in — the
  user's browser still holds the real Clerk session, so the new link completes
  in one click without re-entering credentials.
