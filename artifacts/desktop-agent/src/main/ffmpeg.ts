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
  percent: number;
  frame?: number;
  kbps?: number;
}

/**
 * Generates a 720p H.264 proxy (same profile as the server pipeline) from a
 * raw source file. Reports cumulative progress via the `onProgress` callback
 * parsed from ffmpeg's stderr, then emits `onEnd` with the output path.
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

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stderr += line;
      const timeMatch = /time=(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
      if (timeMatch) {
        const seconds =
          Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
        // total duration isn't always known up front; emit raw progress anyway
        opts.onProgress({ percent: -1, frame: undefined });
        void seconds;
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to launch ffmpeg: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-1000)}`));
        return;
      }
      const stat = fs.statSync(opts.outputPath);
      opts.onProgress({ percent: 100 });
      resolve({ outputPath: opts.outputPath, sizeBytes: stat.size });
    });
  });
}