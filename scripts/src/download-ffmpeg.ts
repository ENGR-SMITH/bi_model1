/**
 * Downloads FFmpeg binaries for the current platform and places them in
 * artifacts/desktop-agent/ffmpeg/ for electron-builder to bundle as extraResources.
 *
 * Usage: npx tsx scripts/src/download-ffmpeg.ts
 *
 * Windows: Downloads from BtbN/FFmpeg-Builds (GPL static build)
 * macOS/Linux: Skips (users can install via Homebrew/apt)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FFMPEG_DIR = path.resolve(__dirname, "../../artifacts/desktop-agent/ffmpeg");

// BtbN FFmpeg-Builds — latest gpl static build (Windows only)
const WIN_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith("https") ? https.get : http.get;

    get(url, { headers: { "User-Agent": "tandem-agent-build" } }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        void download(res.headers.location, dest).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const total = parseInt(res.headers["content-length"] || "0", 10);
      let downloaded = 0;

      res.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = ((downloaded / total) * 100).toFixed(1);
          process.stdout.write(`\rDownloading FFmpeg... ${pct}%`);
        }
      });

      res.pipe(file);
      file.on("finish", () => {
        file.close();
        console.log("\nDone.");
        resolve();
      });
    }).on("error", (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

async function main() {
  const platform = process.platform;

  // Only bundle FFmpeg on Windows — macOS users can use Homebrew, Linux users apt
  if (platform !== "win32") {
    console.log(`Skipping FFmpeg download on ${platform} (users can install via Homebrew/apt).`);
    return;
  }

  console.log("Platform: win32");
  console.log(`FFmpeg URL: ${WIN_URL}`);

  // Create output directory
  fs.mkdirSync(FFMPEG_DIR, { recursive: true });

  // Check if FFmpeg already exists
  const finalBin = path.join(FFMPEG_DIR, "ffmpeg.exe");
  if (fs.existsSync(finalBin)) {
    console.log(`FFmpeg already exists at ${finalBin}, skipping download.`);
    return;
  }

  // Download
  const tmpFile = path.join(FFMPEG_DIR, "download.tmp");
  console.log("Downloading FFmpeg...");
  await download(WIN_URL, tmpFile);

  // Extract ONLY the ffmpeg.exe binary (this is a statically-linked GPL build,
  // so it needs no DLLs). Inflating the whole archive would unpack the docs and
  // dev trees too — tens of thousands of tiny files that make the CI step slow
  // enough to get canceled.
  console.log("Extracting ffmpeg.exe only...");
  execSync(`unzip -jo "${tmpFile}" "*/bin/ffmpeg.exe" -d "${FFMPEG_DIR}"`, { stdio: "inherit" });

  if (!fs.existsSync(finalBin)) {
    throw new Error("Extraction did not produce ffmpeg.exe");
  }

  // Clean up
  fs.rmSync(path.join(FFMPEG_DIR, "ffmpeg-master-latest-win64-gpl"), { recursive: true, force: true });
  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }

  console.log(`FFmpeg installed to ${finalBin}`);
}

main().catch((err) => {
  console.error("Failed to download FFmpeg:", err);
  process.exit(1);
});
