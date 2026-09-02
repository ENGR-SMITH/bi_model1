// Detects whether a video is currently playing on Windows by asking the OS
// GlobalSystemMediaTransportControls session manager (the same "now playing"
// feed that drives the media keys overlay) through a small PowerShell call.
//
// Windows-only. On other platforms these functions return empty/no match so
// the widget simply never auto-shows.
import { spawn } from "node:child_process";

export interface MediaSessionInfo {
  appId: string;
  title: string;
  status: number; // 4 = Playing (Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus)
}

/**
 * App-ids we treat as "could be showing a video": browsers and desktop media
 * players. Music apps (Spotify, iTunes, …) don't match, so background music
 * won't summon the bubble. This is intentionally a best-effort allowlist.
 */
const VIDEO_APP_RE =
  /(chrome|msedge|firefox|opera|brave|vivaldi|browser|vlc|mpv|potplayer|kmplayer|mpc-hc|zunevideo|windowsmediaplayer|mediaplayer|netflix|plex|mx player|mxplayer)/i;

// Note: the PowerShell generics use backticks (`` `1 ``), so they're escaped
// here — the backticks are PowerShell syntax, not TypeScript template syntax.
const POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if ($null -eq $manager) { exit 0 }
foreach ($session in $manager.GetSessions()) {
  try {
    $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $playback = $session.GetPlaybackInfo()
    if ($null -ne $props) {
      [PSCustomObject]@{
        appId = $session.SourceAppUserModelId
        title = $props.Title
        status = [int]$playback.PlaybackStatus
      } | ConvertTo-Json -Compress
    }
  } catch {}
}
`;

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        { windowsHide: true },
      );
    } catch {
      resolve("");
      return;
    }
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    // A hung PowerShell (rare) shouldn't stall the polling loop forever.
    const killer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }, 8000);
    child.on("error", () => {
      clearTimeout(killer);
      resolve("");
    });
    child.on("close", () => {
      clearTimeout(killer);
      resolve(out);
    });
  });
}

/** Lists current media sessions; empty on non-Windows or when the query fails. */
export async function listMediaSessions(): Promise<MediaSessionInfo[]> {
  if (process.platform !== "win32") return [];
  const out = await runPowerShell(POWERSHELL_SCRIPT);
  const sessions: MediaSessionInfo[] = [];
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as MediaSessionInfo;
      if (typeof parsed.appId === "string" && typeof parsed.status === "number") {
        sessions.push({ appId: parsed.appId, title: parsed.title ?? "", status: parsed.status });
      }
    } catch {
      // skip malformed lines
    }
  }
  return sessions;
}

/** True when a session from a video-capable app is actively playing with a title. */
export function isVideoPlaying(sessions: MediaSessionInfo[]): boolean {
  return sessions.some(
    (s) => s.status === 4 && s.title.trim().length > 0 && VIDEO_APP_RE.test(s.appId || ""),
  );
}
