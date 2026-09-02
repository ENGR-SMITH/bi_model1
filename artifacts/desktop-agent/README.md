# Tandem Desktop Agent

A small Windows/macOS desktop app that generates a 720p H.264 proxy from a raw
video using **local FFmpeg**, then uploads it **directly to Cloudflare R2**
through presigned URLs — no raw bytes ever touch your server (and no egress
cost, since R2 serves from the edge).

It is the "large-file / desktop agent" half of the Cloudflare R2 integration.
The browser handles files up to ~2 GB; anything bigger (and, for lower CPU
load, typical proxies too) is best pushed by this agent.

## How it works

```
Your machine                 Your API server                       Cloudflare R2
   │ pick raw file                  │
   │ FFmpeg → 720p proxy            │
   │ POST …/proxy-upload-url ──────▶│  checks access + quota,
   │                                │  mints 15-min presigned PUT
   │ PUT proxy bytes ◀──────────────┼─────────────────────────────▶
   │                                │   (server never touches bytes)
   │ POST …/proxy-ready ──────────▶│  verifies via object HEAD,
   │  (asset → PROCESSED)           │   proxy streams via presigned GET
```

The agent signs in with **Clerk** in a bundled browser window and reuses your
existing account. It talks to the same API the web apps use.

## Prerequisites on the user's machine

- **FFmpeg** — bundled in the installer (no extra install needed).
  If you have a custom FFmpeg installation, set `TANDEM_FFMPEG_PATH` to use it instead.
- Nothing else — no Node needed once packaged.

## Configuration

Create `tandem-agent.json` next to the app (or `~/.tandem-agent/config.json`),
or set environment variables:

```json
{
  "apiBaseUrl": "https://your-api.example.com",
  "clerkPublishableKey": "pk_test_...",
  "ffmpegPath": "C:\\ffmpeg\\bin\\ffmpeg.exe",
  "workDir": "C:\\Users\\you\\.tandem-agent\\work",
  "updateUrl": "https://media.example.com/desktop-agent"
}
```

| Config / env            | Meaning                                |
| ----------------------- | -------------------------------------- |
| `TANDEM_API_URL`        | API base, no trailing slash. Default `http://localhost:3000` |
| `TANDEM_CLERK_PUBLISHABLE_KEY` | Your Clerk **publishable** key. |
| `TANDEM_FFMPEG_PATH`    | Path to the ffmpeg binary (optional; else on PATH). |
| `TANDEM_AGENT_WORK_DIR` | Temp dir for staged proxies. |
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

## Auto-update

The installed app checks for updates on launch (and via the **Check for updates**
button in the footer) and downloads them in the background; when a new version is
ready the button becomes **Restart & update**. Releases are published by the
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
when clicked. Enable it from the **Widget** card in the app — no restart needed:

- **Floating widget** — master on/off switch. When on, the app keeps running in
  the tray after you close its window (click the tray icon to reopen, or **Quit
  Tandem Agent** from its menu).
- **Auto-show while a video plays** — when Windows reports a video playing in a
  browser or media player (via the OS media-session feed), the bubble appears;
  it disappears a few seconds after playback stops. Detection polls every ~3 s
  and only matches apps it recognizes as video-capable, so plain music apps
  don't summon it.
- **Fallbacks** — press `Ctrl+Alt+T` or use the tray menu to show/hide the
  bubble anytime. Drag it anywhere; its position is remembered.

Clicking the bubble opens the agent window. Windows-only for now; on macOS/Linux
the toggle is disabled and the app runs as a normal window.

## Signing in

1. Launch the app → click **Sign in** → the Clerk window opens.
2. Sign in with your Tandem/Clerk account.
3. Pick a **project**, an **asset** (a raw file already in the vault), and a
   **source raw file** on disk.
4. Click **Generate proxy & upload to R2**.

The vault then shows the asset as processed, and its `PROXY` row is stored in
R2 with `storage_provider = "r2"`, streamed back to browsers via presigned
GETs.

## Notes & current limits

- The video widget's auto-show uses the Windows media-session feed, so it only
  knows about apps that publish to it (browsers, VLC, Movies & TV, …).
  Detection is best-effort and polls every ~3 s; use `Ctrl+Alt+T` / the tray
  if it misses something.
- The server endpoints the agent calls (`proxy-upload-url` / `proxy-ready`)
  only respond when R2 env vars are configured on the API server.
- Only proxies upload via the agent today; originals, exports, and bundles are
  uploaded by the web/worker path. Extending the agent to upload originals is a
  small follow-up (same presigned flow, different key prefix).
- The Clerk session token is captured from the `__session` cookie and reused as
  a bearer token. It's short-lived; re-request it per sign-in.