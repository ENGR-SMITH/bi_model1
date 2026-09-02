/**
 * Downloads FFmpeg binaries for the current platform and places them in
 * artifacts/desktop-agent/ffmpeg/ for electron-builder to bundle as extraResources.
 *
 * Usage: npx tsx scripts/src/download-ffmpeg.ts
 *
 * Sources:
 *   Windows: https://github.com/BtbN/FFmpeg-Builds/releases
 *   macOS:   https://github.com/BtbN/FFmpeg-Builds/releases
 *   Linux:   https://github.com/BtbN/FFmpeg-Builds/releases
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";

const FFMPEG_DIR = path.resolve(__dirname, "../../artifacts/desktop-agent/ffmpeg");

// BtbN FFmpeg-Builds — latest gpl shared builds
const BUILDS_BASE = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest";

const BUILDS: Record<string, { url: string; binaryName: string; extract: ( dest: string, tmp: string) => void }> = {
  win32: {
    url: `${BUILDS_BASE}/ffmpeg-master-latest-win64-gpl.zip`,
    binaryName: "ffmpeg.exe",
    extract: (dest, tmp) => {
      execSync(`unzip -o "${tmp}" -d "${dest}"`, { stdio: "inherit" });
      // The zip extracts to ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe
      const extractedBin = path.join(dest, "ffmpeg-master-latest-win64-gpl", "bin", "ffmpeg.exe");
      const finalBin = path.join(dest, "ffmpeg.exe");
      fs.copyFileSync(extractedBin, finalBin);
      // Clean up extracted directory
      fs.rmSync(path.join(dest, "ffmpeg-master-latest-win64-gpl"), { recursive: true, force: true });
    },
  },
  darwin: {
    url: `${BUILDS_BASE}/ffmpeg-master-latest-macosarm64-gpl.zip`,
    binaryName: "ffmpeg",
    extract: (dest, tmp) => {
      execSync(`unzip -o "${tmp}" -d "${dest}"`, { stdio: "inherit" });
      // The zip extracts to ffmpeg-master-latest-macosarm64-gpl/bin/ffmpeg
      const extractedBin = path.join(dest, "ffmpeg-master-latest-macosarm64-gpl", "bin", "ffmpeg");
      const finalBin = path.join(dest, "ffmpeg");
      fs.copyFileSync(extractedBin, finalBin);
      fs.chmodSync(finalBin, 0o755);
      // Clean up extracted directory
      fs.rmSync(path.join(dest, "ffmpeg-master-latest-macosarm64-gpl"), { recursive: true, force: true });
    },
  },
  linux: {
    url: `${BUILDS_BASE}/ffmpeg-master-latest-linux64-gpl.tar.xz`,
    binaryName: "ffmpeg",
    extract: (dest, tmp) => {
      execSync(`tar -xf "${tmp}" -C "${dest}"`, { stdio: "inherit" });
      const extractedBin = path.join(dest, "ffmpeg-master-latest-linux64-gpl", "bin", "ffmpeg");
      const finalBin = path.join(dest, "ffmpeg");
      fs.copyFileSync(extractedBin, finalBin);
      fs.chmodSync(finalBin, 0o755);
      fs.rmSync(path.join(dest, "ffmpeg-master-latest-linux64-gpl"), { recursive: true, force: true });
    },
  },
};

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith("https") ? https.get : http.get;

    get(url, { headers: { "User-Agent": "tandem-agent-build" } }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return download(res.headers.location, dest).then(resolve, reject);
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
  const platform = process.platform as keyof typeof BUILDS;
  const build = BUILDS[platform];

  if (!build) {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
  }

  console.log(`Platform: ${platform}`);
  console.log(`FFmpeg URL: ${build.url}`);

  // Create output directory
  fs.mkdirSync(FFMPEG_DIR, { recursive: true });

  // Check if FFmpeg already exists
  const finalBin = path.join(FFMPEG_DIR, build.binaryName);
  if (fs.existsSync(finalBin)) {
    console.log(`FFmpeg already exists at ${finalBin}, skipping download.`);
    return;
  }

  // Download
  const tmpFile = path.join(FFMPEG_DIR, "download.tmp");
  console.log("Downloading FFmpeg...");
  await download(build.url, tmpFile);

  // Extract
  console.log("Extracting...");
  build.extract(FFMPEG_DIR, tmpFile);

  // Clean up temp file
  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }

  console.log(`FFmpeg installed to ${finalBin}`);
}

main().catch((err) => {
  console.error("Failed to download FFmpeg:", err);
  process.exit(1);
});
