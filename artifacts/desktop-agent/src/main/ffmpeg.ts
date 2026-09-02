import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ProxyOutput {
  outputPath: string;
  sizeBytes: number;
}

export function resolveFfmpeg(configured: string): string {
  // 1. User-configured path (env var or config file)
  if (configured) {
    if (fs.existsSync(configured)) return configured;
    return configured;
  }

  // 2. Bundled FFmpeg (shipped with the app via extraResources)
  const isWin = process.platform === "win32";
  const bundledName = isWin ? "ffmpeg.exe" : "ffmpeg";
  const bundledPath = path.join(
    process.resourcesPath || path.join(__dirname, "../../../"),
    "ffmpeg",
    bundledName,
  );
  if (fs.existsSync(bundledPath)) return bundledPath;

  // 3. Fall back to system PATH
  return "ffmpeg";
}

export interface Progress {
  /** 0-100 once the input duration is known; -1 while it isn't yet. */
  percent: number;
}

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const TIME_RE = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g;
const MIN_EMIT_INTERVAL_MS = 180;

function parseHms(m: RegExpMatchArray): number {
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Generates a 720p H.264 proxy (same profile as the server pipeline) from a
 * raw source file. Reports cumulative progress via the `onProgress` callback
 * parsed from ffmpeg's stderr, then emits `onEnd` with the output path.
 *
 * ffmpeg prints the input `Duration:` line before encoding starts and then a
 * rolling `time=…` cursor, so we can compute real percentages. When the
 * duration line hasn't appeared yet we emit `percent: -1` so the caller can
 * show an indeterminate state.
 */
export function makeProxy(opts: {
  ffmpegPath: string;
  inputPath: string;
  outputPath: string;
  onProgress: (p: Progress) => void;
}): Promise<ProxyOutput> {
  const outDir = path.dirname(opts.outputPath);
  fs.mkdirSync(outDir, { recursive: true });

  return new Promise<ProxyOutput>((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      opts.inputPath,
      "-vf",
      "scale=-2:720,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      opts.outputPath,
    ];

    let child: ChildProcess;
    try {
      child = spawn(opts.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (err) {
      reject(err as Error);
      return;
    }

    let durationSeconds: number | null = null;
    let tail = "";
    let lastEmit = 0;

    const emit = (percent: number) => {
      const now = Date.now();
      if (now - lastEmit < MIN_EMIT_INTERVAL_MS) return;
      lastEmit = now;
      opts.onProgress({ percent });
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      // Keep only a rolling tail; ffmpeg progress lines use \r so the full
      // buffer would otherwise grow unboundedly for long encodes.
      tail = (tail + line).slice(-8192);

      if (durationSeconds === null) {
        const duration = DURATION_RE.exec(tail);
        if (duration) {
          durationSeconds = parseHms(duration);
        } else {
          // Input duration not printed yet — nothing measurable so far.
          emit(-1);
          return;
        }
      }

      const times = [...tail.matchAll(TIME_RE)];
      const last = times[times.length - 1];
      if (last && durationSeconds !== null && durationSeconds > 0) {
        const seconds = parseHms(last);
        const percent = Math.min(99, Math.floor((seconds / durationSeconds) * 100));
        emit(percent);
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to launch ffmpeg: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${tail.slice(-1000)}`));
        return;
      }
      const stat = fs.statSync(opts.outputPath);
      opts.onProgress({ percent: 100 });
      resolve({ outputPath: opts.outputPath, sizeBytes: stat.size });
    });
  });
}
