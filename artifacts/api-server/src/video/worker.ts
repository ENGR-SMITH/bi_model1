// ---------------------------------------------------------------------------
// M1 processing pipeline — Postgres-backed job queue with an in-process worker.
//
// Today the queue is a `tandem_video_jobs` table polled by a setInterval loop
// inside the API server process. When Tandem moves to Docker workers (per the
// blueprint) the row contract stays identical: BullMQ/Redis simply becomes the
// claim layer and the processors below move into the worker image unchanged.
//
// Tool detection drives three modes:
//   - real:  ffmpeg/ffprobe present → transcoded low-res proxy; faster-whisper
//            present → real transcript segments.
//   - demo:  missing tools → a flagged copy of the original as the "proxy" and
//            a clearly-marked demo transcript, so the whole M1 loop (upload →
//            proxy → transcribe → studio) runs end-to-end today.
//   - force demo: TANDEM_MEDIA_DEMO=1 always uses demo mode (tests do this).
// ---------------------------------------------------------------------------

import {
  db,
  tandemVideoAssetFilesTable,
  tandemVideoAssetsTable,
  tandemVideoJobsTable,
  tandemVideoReferencesTable,
  tandemVideoSyncsTable,
  tandemVideoTimelinesTable,
  tandemVideoTimelineVersionsTable,
  tandemVideoTranscriptsTable,
  tandemVideoTranscriptSegmentsTable,
  type TandemVideoAsset,
  type TandemVideoJob,
} from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../lib/logger";
import { emitJobProgress, emitToProject } from "../realtime";
import { attachQueueEventBridge, bullmqEnabled, enqueueBullMqJob } from "./queues";
import { buildCheckout } from "./checkout";
import { buildZip, type ZipEntry } from "./zip";

const JOB_BATCH_SIZE = 5;
const POLL_INTERVAL_MS = 2000;

export function uploadDir(): string {
  return process.env.VIDEO_UPLOAD_DIR || path.resolve(process.cwd(), ".uploads", "video");
}

function proxyDir(): string {
  return path.join(uploadDir(), "proxies");
}

function renderDir(): string {
  return path.join(uploadDir(), "renders");
}

function bundleDir(): string {
  return path.join(uploadDir(), "bundles");
}

// ---------------------------------------------------------------------------
// Tool detection (cached — detection is only done once per process)
// ---------------------------------------------------------------------------

let _tools: { ffmpeg: boolean; ffprobe: boolean; whisper: boolean; melt: boolean } | null = null;
// `undefined` = not probed yet, `null` = probed but not found.
let _ffmpegPath: string | null | undefined;
let _ffprobePath: string | null | undefined;

function runOk(command: string, args: string[]): boolean {
  try {
    return spawnSync(command, args, { stdio: "ignore", timeout: 8000 }).status === 0;
  } catch {
    return false;
  }
}

function existingFile(candidate: string): string | null {
  try {
    return fs.existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Well-known Windows install locations for FFmpeg (WinGet, Chocolatey, Scoop).
 * The WinGet package directory is version-hashed, so we glob for any
 * `Gyan.FFmpeg*` directory instead of hardcoding the hash or the username.
 */
function windowsFfmpegDirs(): string[] {
  const dirs: string[] = [];
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");

  const wingetPackages = path.join(localAppData, "Microsoft", "WinGet", "Packages");
  try {
    if (fs.existsSync(wingetPackages)) {
      for (const entry of fs.readdirSync(wingetPackages)) {
        if (/^Gyan\.FFmpeg/i.test(entry)) dirs.push(path.join(wingetPackages, entry, "bin"));
      }
    }
  } catch {
    // unreadable dir — skip
  }

  const programData = process.env.ProgramData || "C:\\ProgramData";
  dirs.push(path.join(programData, "chocolatey", "bin"));
  dirs.push(path.join(home, "scoop", "shims"));
  return dirs;
}

/**
 * Locate an FFmpeg-family binary: explicit env override → PATH → known Windows
 * install dirs. Returns the bare command name (PATH hit) or the absolute path.
 */
function findTool(envVar: string, exeName: string): string | null {
  const override = process.env[envVar];
  if (override) {
    const resolved = existingFile(override);
    if (resolved && runOk(resolved, ["-version"])) return resolved;
  }

  if (runOk(exeName, ["-version"])) return exeName;

  if (process.platform === "win32") {
    for (const dir of windowsFfmpegDirs()) {
      const resolved = existingFile(path.join(dir, exeName));
      if (resolved && runOk(resolved, ["-version"])) return resolved;
    }
  }

  return null;
}

function findFFmpeg(): string | null {
  return findTool("FFMPEG_PATH", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
}

function findFFprobe(): string | null {
  return findTool("FFPROBE_PATH", process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
}

function hasCommand(command: string, args: string[]): boolean {
  return runOk(command, args);
}

function hasWhisper(): boolean {
  const probe = "import faster_whisper; print('ok')";
  return (
    hasCommand("python", ["-c", probe]) ||
    hasCommand("python3", ["-c", probe]) ||
    hasCommand("py", ["-c", probe])
  );
}

export function detectTools(): { ffmpeg: boolean; ffprobe: boolean; whisper: boolean; melt: boolean } {
  if (process.env.TANDEM_MEDIA_DEMO === "1") {
    _tools = { ffmpeg: false, ffprobe: false, whisper: false, melt: false };
    return _tools;
  }
  if (_tools) return _tools;

  if (_ffmpegPath === undefined) _ffmpegPath = findFFmpeg();
  if (_ffprobePath === undefined) _ffprobePath = findFFprobe();

  _tools = {
    ffmpeg: _ffmpegPath !== null,
    ffprobe: _ffprobePath !== null,
    whisper: hasWhisper(),
    melt: hasCommand("melt", ["-version"]),
  };
  return _tools;
}

export function getFFmpegPath(): string | null {
  if (_ffmpegPath === undefined) _ffmpegPath = findFFmpeg();
  return _ffmpegPath ?? null;
}

export function getFFprobePath(): string | null {
  if (_ffprobePath === undefined) _ffprobePath = findFFprobe();
  return _ffprobePath ?? null;
}

export function isDemoMode(): boolean {
  const tools = detectTools();
  return !tools.ffmpeg || !tools.whisper;
}

// ---------------------------------------------------------------------------
// Job enqueueing
// ---------------------------------------------------------------------------

export async function enqueueAssetJobs(asset: TandemVideoAsset): Promise<void> {
  const jobs: Array<{ id: string; projectId: string; assetId: string; type: string }> = [];
  for (const type of ["PROXY", "TRANSCRIBE"] as const) {
    jobs.push({ id: randomUUID(), projectId: asset.projectId, assetId: asset.id, type });
  }
  await db.insert(tandemVideoJobsTable).values(jobs);
  for (const job of jobs) {
    emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "QUEUED" });
    await enqueueBullMqJob(job);
  }
}

/** Re-queues a single PROXY job for an asset whose file went missing on disk. */
export async function requeueProxyJob(projectId: string, assetId: string): Promise<void> {
  const job = { id: randomUUID(), projectId, assetId, type: "PROXY" as const };
  await db.insert(tandemVideoJobsTable).values(job);
  emitJobProgress({ projectId, jobId: job.id, type: job.type, status: "QUEUED" });
  await enqueueBullMqJob(job);
}

/** Queues a multi-cam waveform sync between `assetId` (primary) and `targetAssetId`. */
export async function enqueueSyncJob(
  projectId: string,
  assetId: string,
  targetAssetId: string,
): Promise<TandemVideoJob> {
  const [job] = await db
    .insert(tandemVideoJobsTable)
    .values({
      id: randomUUID(),
      projectId,
      assetId,
      type: "SYNC",
      params: { targetAssetId },
    })
    .returning();
  emitJobProgress({ projectId, jobId: job.id, type: job.type, status: "QUEUED" });
  await enqueueBullMqJob(job);
  return job;
}

/** Queues a render of a leg timeline. `assetId` is the head clip's source. */
export async function enqueueRenderJob(
  projectId: string,
  leg: string,
  format: "PREVIEW" | "PICTURE_LOCK",
  assetId: string,
  timelineVersionId: string,
): Promise<void> {
  const [job] = await db
    .insert(tandemVideoJobsTable)
    .values({
      id: randomUUID(),
      projectId,
      assetId,
      type: "RENDER",
      params: { leg, format, timelineVersionId },
    })
    .returning();
  emitJobProgress({ projectId, jobId: job.id, type: job.type, status: "QUEUED" });
  await enqueueBullMqJob(job);
}

/**
 * Queues a background checkout bundle build for a leg. Project-scoped (no
 * anchor asset) so any member can trigger it; the worker materializes all
 * four interchange documents + manifest (and media, on request) into a zip.
 */
export async function enqueueExportBundleJob(
  projectId: string,
  leg: string,
  includeMedia = false,
): Promise<TandemVideoJob> {
  const [job] = await db
    .insert(tandemVideoJobsTable)
    .values({
      id: randomUUID(),
      projectId,
      assetId: null,
      type: "EXPORT_BUNDLE",
      params: { leg, includeMedia },
    })
    .returning();
  emitJobProgress({ projectId, jobId: job.id, type: job.type, status: "QUEUED" });
  await enqueueBullMqJob(job);
  return job;
}

/** True when a bundle build is already queued/running for this leg (dedupe). */
export async function hasActiveExportBundle(projectId: string, leg: string): Promise<boolean> {
  const active = await db
    .select()
    .from(tandemVideoJobsTable)
    .where(
      and(
        eq(tandemVideoJobsTable.projectId, projectId),
        eq(tandemVideoJobsTable.type, "EXPORT_BUNDLE"),
        inArray(tandemVideoJobsTable.status, ["QUEUED", "RUNNING"]),
      ),
    );
  // A bundle job is leg-scoped via its params; the dedupe is per-leg.
  return active.some((job) => (job.params as { leg?: string } | null)?.leg === leg);
}

/** True when a render is already queued/running for this leg (dedupe). */
export async function hasActiveRender(projectId: string, leg: string): Promise<boolean> {
  const active = await db
    .select()
    .from(tandemVideoJobsTable)
    .where(
      and(
        eq(tandemVideoJobsTable.projectId, projectId),
        eq(tandemVideoJobsTable.type, "RENDER"),
        inArray(tandemVideoJobsTable.status, ["QUEUED", "RUNNING"]),
      ),
    );
  return active.length > 0;
}

// ---------------------------------------------------------------------------
// Processors
// ---------------------------------------------------------------------------

interface ProxyResult {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  demo: boolean;
  metadata: Record<string, unknown>;
}

async function processProxy(asset: TandemVideoAsset): Promise<ProxyResult> {
  const tools = detectTools();
  const sourcePath = path.join(uploadDir(), asset.storageKey);

  if (tools.ffmpeg && tools.ffprobe) {
    // Real proxy: 720p h.264 with AAC audio, faststart so the browser can
    // stream it. `-n` fails fast instead of overwriting a previous render.
    fs.mkdirSync(proxyDir(), { recursive: true });
    const outKey = `proxies/${asset.id}.mp4`;
    const outPath = path.join(uploadDir(), outKey);

    const probe = spawnSync(
      getFFprobePath() || "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", sourcePath],
      { encoding: "utf8", timeout: 60000 },
    );
    let durationMs: number | null = null;
    if (probe.status === 0) {
      try {
        const parsed = JSON.parse(probe.stdout);
        durationMs = Math.round(Number(parsed.format?.duration ?? 0) * 1000) || null;
      } catch {
        durationMs = null;
      }
    }

    const encode = spawnSync(
      getFFmpegPath() || "ffmpeg",
      [
        "-y",
        "-i",
        sourcePath,
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
        outPath,
      ],
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 60 * 60 * 1000 },
    );
    if (encode.status !== 0) {
      const stderr = String(encode.stderr ?? "").trim();
      throw new Error(
        `ffmpeg proxy encode failed (exit ${encode.status ?? "signal"})${
          stderr ? `: ${stderr.slice(-1200)}` : ""
        }`,
      );
    }

    const stat = fs.statSync(outPath);
    const result: ProxyResult = {
      storageKey: outKey,
      mimeType: "video/mp4",
      sizeBytes: stat.size,
      demo: false,
      metadata: {
        width: 1280,
        height: 720,
        degraded: true,
        durationMs,
      },
    };

    if (durationMs !== null) {
      await db
        .update(tandemVideoAssetsTable)
        .set({ durationMs })
        .where(eq(tandemVideoAssetsTable.id, asset.id));
    }
    return result;
  }

  // Demo mode: no ffmpeg available — the "proxy" is the original file, clearly
  // flagged so the studio never mistakes it for a real degraded render.
  return {
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    demo: true,
    metadata: { demo: true, degraded: false, reason: "ffmpeg not installed" },
  };
}

async function processTranscribe(asset: TandemVideoAsset): Promise<{
  transcriptId: string;
  model: string;
  demo: boolean;
  segmentCount: number;
}> {
  const tools = detectTools();
  const sourcePath = path.join(uploadDir(), asset.storageKey);

  if (tools.whisper) {
    const outPath = path.join(uploadDir(), `${asset.id}.transcript.json`);
    const script = [
      "import json, sys",
      "from faster_whisper import WhisperModel",
      "model = WhisperModel('small', device='cpu', compute_type='int8')",
      "segments, info = model.transcribe(sys.argv[1])",
      "rows = [{'start': round(s.start * 1000), 'end': round(s.end * 1000), 'text': s.text.strip(), 'speaker': None} for s in segments]",
      "json.dump({'language': info.language or 'en', 'segments': rows}, open(sys.argv[2], 'w'))",
    ].join("\n");
    const run = spawnSync(
      "python",
      ["-c", script, sourcePath, outPath],
      { encoding: "utf8", timeout: 60 * 30 * 1000 },
    );
    if (run.status !== 0) {
      throw new Error(`faster-whisper transcription failed: ${run.stderr?.slice(0, 500) ?? "unknown error"}`);
    }
    let payload: { language: string; segments: Array<{ start: number; end: number; text: string; speaker: string | null }> };
    try {
      payload = JSON.parse(fs.readFileSync(outPath, "utf8"));
    } catch (error) {
      throw new Error(`Transcription output could not be read: ${(error as Error).message}`);
    }

    const transcriptId = randomUUID();
    await db.insert(tandemVideoTranscriptsTable).values({
      id: transcriptId,
      assetId: asset.id,
      language: payload.language || "en",
      model: "faster-whisper",
      status: "READY",
    });
    if (payload.segments.length > 0) {
      await db.insert(tandemVideoTranscriptSegmentsTable).values(
        payload.segments.map((segment) => ({
          id: randomUUID(),
          transcriptId,
          startMs: segment.start,
          endMs: segment.end,
          text: segment.text,
          speaker: segment.speaker,
        })),
      );
    }
    return { transcriptId, model: "faster-whisper", demo: false, segmentCount: payload.segments.length };
  }

  // Demo mode: synthesize a clearly-marked transcript so the studio's search
  // and selects workflow is exercisable without faster-whisper installed.
  const transcriptId = randomUUID();
  const demoText =
    "Demo transcript — install faster-whisper to transcribe this footage for real. " +
    "Every word here is placeholder text so the selects studio stays usable end-to-end.";
  const chunks = demoText.match(/.{1,72}(\s|$)/g) ?? [demoText];
  await db.insert(tandemVideoTranscriptsTable).values({
    id: transcriptId,
    assetId: asset.id,
    language: "en",
    model: "demo",
    status: "DEMO",
  });
  const segments = chunks.map((chunk, index) => ({
    id: randomUUID(),
    transcriptId,
    startMs: index * 3000,
    endMs: (index + 1) * 3000,
    text: chunk.trim(),
    speaker: null,
  }));
  await db.insert(tandemVideoTranscriptSegmentsTable).values(segments);
  return { transcriptId, model: "demo", demo: true, segmentCount: segments.length };
}

// ---------------------------------------------------------------------------
// M2 — multi-cam waveform sync + preview/picture-lock renders
// ---------------------------------------------------------------------------

// Decimates raw mono PCM (s16le, 16 kHz) to a ~2 kHz low-passed envelope, so
// cross-correlation stays fast while remaining robust to codec differences.
function pcmToEnvelope(pcm: Int16Array, factor = 8): Float32Array {
  const out = new Float32Array(Math.floor(pcm.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) {
      sum += Math.abs(pcm[i * factor + j]) / 32768;
    }
    out[i] = sum / factor;
  }
  return out;
}

// Cross-correlation via FFT. Returns the lag (in envelope samples) that best
// aligns `b` to `a`: positive = b leads a. The FFT gives the full circular
// correlation in one pass; we scan for the peak magnitude. Envelope samples
// are 0.5 ms apart (16 kHz / 8), so this resolves offsets to the frame level.
function findBestLag(a: Float32Array, b: Float32Array): number {
  let size = 1;
  while (size < a.length + b.length - 1) size *= 2;

  const fftA = new Float32Array(size * 2);
  const fftB = new Float32Array(size * 2);
  for (let i = 0; i < a.length; i++) fftA[i * 2] = a[i];
  for (let i = 0; i < b.length; i++) fftB[i * 2] = b[i];

  fft(fftA, false);
  fft(fftB, false);

  // Multiply: A * conj(B)
  const corr = new Float32Array(size * 2);
  for (let i = 0; i < size; i++) {
    const ar = fftA[i * 2];
    const ai = fftA[i * 2 + 1];
    const br = fftB[i * 2];
    const bi = fftB[i * 2 + 1];
    corr[i * 2] = ar * br + ai * bi; // real(A * conj(B))
    corr[i * 2 + 1] = ai * br - ar * bi;
  }
  fft(corr, true);

  // Peak of |corr| → the lag where the two signals line up.
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < size; i++) {
    const v = Math.abs(corr[i * 2]);
    if (v > bestScore) {
      bestScore = v;
      best = i;
    }
  }
  // FFT correlation index i ↔ lag (i - (b.length - 1)): positive when b leads.
  return best - (b.length - 1);
}

// In-place radix-2 Cooley–Tukey FFT on interleaved complex data.
function fft(data: Float32Array, inverse: boolean): void {
  const n = data.length / 2;
  if (n <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const ri = i * 2;
      const rj = j * 2;
      const tr = data[ri];
      const ti = data[ri + 1];
      data[ri] = data[rj];
      data[ri + 1] = data[rj + 1];
      data[rj] = tr;
      data[rj + 1] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len * (inverse ? 1 : -1);
    const wlenR = Math.cos(ang);
    const wlenI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uIdx = (i + j) * 2;
        const vIdx = (i + j + len / 2) * 2;
        const ur = data[uIdx];
        const ui = data[uIdx + 1];
        const vr = data[vIdx] * wr - data[vIdx + 1] * wi;
        const vi = data[vIdx] * wi + data[vIdx + 1] * wr;
        data[uIdx] = ur + vr;
        data[uIdx + 1] = ui + vi;
        data[vIdx] = ur - vr;
        data[vIdx + 1] = ui - vi;
        const nwr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nwr;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < data.length; i++) data[i] /= n;
  }
}

// Extracts the first ~12s of mono 16 kHz audio as raw s16le PCM via ffmpeg.
function extractPcm(filePath: string): Int16Array | null {
  const run = spawnSync(
    getFFmpegPath() || "ffmpeg",
    [
      "-y",
      "-i",
      filePath,
      "-t",
      "12",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024 * 8, timeout: 60000 },
  );
  if (run.status !== 0 || !run.stdout || run.stdout.length < 1024) return null;
  return new Int16Array(run.stdout.buffer, run.stdout.byteOffset, run.stdout.length / 2);
}

async function processSync(asset: TandemVideoAsset, job: TandemVideoJob): Promise<{
  offsetMs: number;
  method: string;
  demo: boolean;
}> {
  const targetAssetId = (job.params as { targetAssetId?: string } | null)?.targetAssetId;
  if (!targetAssetId) {
    throw new Error("Sync job is missing targetAssetId");
  }

  const [target] = await db
    .select()
    .from(tandemVideoAssetsTable)
    .where(eq(tandemVideoAssetsTable.id, targetAssetId))
    .limit(1);
  if (!target) {
    throw new Error(`Sync target asset ${targetAssetId} no longer exists`);
  }

  const tools = detectTools();
  let offsetMs = 0;
  let method = "DEMO";

  if (tools.ffmpeg) {
    const a = extractPcm(path.join(uploadDir(), asset.storageKey));
    const b = extractPcm(path.join(uploadDir(), target.storageKey));
    if (a && b && a.length > 1600 && b.length > 1600) {
      const envA = pcmToEnvelope(a);
      const envB = pcmToEnvelope(b);
      // Envelope sample = 8 PCM samples = 0.5 ms at 16 kHz.
      const lag = findBestLag(envA, envB);
      offsetMs = Math.round((lag * 8) / 16);
      method = "WAVEFORM";
      logger.info({ assetId: asset.id, targetAssetId, offsetMs }, "Waveform sync computed");
    }
  }

  // Upsert the sync pair (unique on primary + target).
  const [existing] = await db
    .select()
    .from(tandemVideoSyncsTable)
    .where(
      and(
        eq(tandemVideoSyncsTable.primaryAssetId, asset.id),
        eq(tandemVideoSyncsTable.targetAssetId, targetAssetId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(tandemVideoSyncsTable)
      .set({ offsetMs, method, status: "SYNCED", updatedAt: new Date() })
      .where(eq(tandemVideoSyncsTable.id, existing.id));
  } else {
    await db.insert(tandemVideoSyncsTable).values({
      id: randomUUID(),
      projectId: asset.projectId,
      primaryAssetId: asset.id,
      targetAssetId,
      offsetMs,
      method,
      status: "SYNCED",
    });
  }

  return { offsetMs, method, demo: method === "DEMO" };
}

async function processRender(asset: TandemVideoAsset, job: TandemVideoJob): Promise<{
  format: string;
  leg: string;
  demo: boolean;
  storageKey: string | null;
}> {
  const params = (job.params ?? {}) as { leg?: string; format?: string };
  const leg = params.leg ?? "CUT";
  const format = params.format === "PICTURE_LOCK" ? "PICTURE_LOCK" : "PREVIEW";

  const [timeline] = await db
    .select()
    .from(tandemVideoTimelinesTable)
    .where(
      and(
        eq(tandemVideoTimelinesTable.projectId, asset.projectId),
        eq(tandemVideoTimelinesTable.leg, leg),
      ),
    )
    .limit(1);
  if (!timeline || !timeline.currentVersionId) {
    throw new Error("No saved timeline snapshot to render");
  }

  const [version] = await db
    .select()
    .from(tandemVideoTimelineVersionsTable)
    .where(eq(tandemVideoTimelineVersionsTable.id, timeline.currentVersionId))
    .limit(1);
  if (!version) {
    throw new Error("Timeline head version is missing");
  }

  const snapshot = (version.snapshot ?? {}) as { clips?: Array<{ assetId?: string; inMs?: number; outMs?: number }> };
  const clips = snapshot.clips ?? [];
  if (clips.length === 0) {
    throw new Error("The timeline has no clips to render");
  }

  const tools = detectTools();
  // Real preview render: trim each clip to its in/out and concat. Requires
  // real media on disk — demo uploads (fake bytes) fall back to a receipt.
  if (tools.ffmpeg && tools.ffprobe) {
    const concatFile = path.join(uploadDir(), `${job.id}.concat.txt`);
    const parts: string[] = [];
    for (const clip of clips) {
      const [src] = await db
        .select()
        .from(tandemVideoAssetsTable)
        .where(eq(tandemVideoAssetsTable.id, clip.assetId ?? ""))
        .limit(1);
      if (!src) continue;
      const inSec = (clip.inMs ?? 0) / 1000;
      const durSec = ((clip.outMs ?? 0) - (clip.inMs ?? 0)) / 1000;
      if (durSec <= 0) continue;
      parts.push(`file '${path.join(uploadDir(), src.storageKey).replaceAll("\\", "/")}'`);
      parts.push(`inpoint ${inSec}`);
      parts.push(`outpoint ${inSec + durSec}`);
    }
    if (parts.length === 0) {
      throw new Error("None of the timeline clips have playable sources");
    }
    fs.writeFileSync(concatFile, parts.join("\n"), "utf8");

    fs.mkdirSync(renderDir(), { recursive: true });
    const outKey = `renders/${job.id}.mp4`;
    const outPath = path.join(uploadDir(), outKey);
    const encode = spawnSync(
      getFFmpegPath() || "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatFile,
        "-vf",
        "scale=-2:720,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 60 * 60 * 1000 },
    );
    if (encode.status !== 0) {
      const stderr = String(encode.stderr ?? "").trim();
      throw new Error(
        `ffmpeg render failed (exit ${encode.status ?? "signal"})${
          stderr ? `: ${stderr.slice(-1200)}` : ""
        }`,
      );
    }

    const stat = fs.statSync(outPath);
    await db.insert(tandemVideoAssetFilesTable).values({
      id: randomUUID(),
      assetId: asset.id,
      kind: "RENDER",
      storageKey: outKey,
      mimeType: "video/mp4",
      sizeBytes: stat.size,
      metadata: { format, leg, demo: false },
    });
    return { format, leg, demo: false, storageKey: outKey };
  }

  return {
    format,
    leg,
    demo: true,
    storageKey: null,
  };
}

// ---------------------------------------------------------------------------
// M3 — audio passes, multi-format exports, thumbnail extraction
// ---------------------------------------------------------------------------

// Applies an ffmpeg audio filter chain for a SOUND-leg pass. Real mode writes
// an audio stem AssetFile; demo mode returns an honest receipt.
async function processAudio(asset: TandemVideoAsset, job: TandemVideoJob): Promise<{
  action: string;
  demo: boolean;
  storageKey: string | null;
}> {
  const action = String((job.params as { action?: string } | null)?.action ?? "EQ");
  const tools = detectTools();
  const sourcePath = path.join(uploadDir(), asset.storageKey);

  if (tools.ffmpeg && tools.ffprobe) {
    const filter =
      action === "NOISE_REDUCTION"
        ? "afftdn=nf=-25,highpass=f=80,lowpass=f=12000"
        : action === "DUCKING"
          ? "acompressor=threshold=0.02:ratio=8:attack=20:release=500"
          : action === "LEVELING"
            ? "acompressor=threshold=0.05:ratio=4:attack=10:release=250,alimiter=limit=0.95"
            : "equalizer=f=250:t=q:w=1:g=2,equalizer=f=3500:t=q:w=1:g=1.5,acompressor=threshold=0.04:ratio=3:attack=15:release=300";

    fs.mkdirSync(proxyDir(), { recursive: true });
    const outKey = `proxies/${job.id}-${action.toLowerCase()}.m4a`;
    const outPath = path.join(uploadDir(), outKey);
    const run = spawnSync(
      getFFmpegPath() || "ffmpeg",
      ["-y", "-i", sourcePath, "-vn", "-af", filter, "-c:a", "aac", "-b:a", "192k", outPath],
      { stdio: "ignore", timeout: 60 * 30 * 1000 },
    );
    if (run.status !== 0) {
      throw new Error(`ffmpeg audio pass failed (exit ${run.status ?? "signal"})`);
    }
    const stat = fs.statSync(outPath);
    await db.insert(tandemVideoAssetFilesTable).values({
      id: randomUUID(),
      assetId: asset.id,
      kind: "AUDIO_STEM",
      storageKey: outKey,
      mimeType: "audio/mp4",
      sizeBytes: stat.size,
      metadata: { action, demo: false },
    });
    return { action, demo: false, storageKey: outKey };
  }

  return { action, demo: true, storageKey: null };
}

// Renders one export format (16:9 / 9:16 / 1:1) with aspect-safe framing.
async function processExport(asset: TandemVideoAsset, job: TandemVideoJob): Promise<{
  format: string;
  demo: boolean;
  storageKey: string | null;
}> {
  const format = String((job.params as { format?: string } | null)?.format ?? "16:9");
  const tools = detectTools();
  const sourcePath = path.join(uploadDir(), asset.storageKey);

  if (tools.ffmpeg && tools.ffprobe) {
    // Aspect-safe framing: scale to fill the target, crop the overflow.
    const vf =
      format === "16:9"
        ? "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080"
        : format === "9:16"
          ? "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"
          : "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080";

    fs.mkdirSync(renderDir(), { recursive: true });
    const safeFormat = format.replace(":", "x");
    const outKey = `renders/${job.id}-${safeFormat}.mp4`;
    const outPath = path.join(uploadDir(), outKey);
    const run = spawnSync(
      getFFmpegPath() || "ffmpeg",
      [
        "-y",
        "-i",
        sourcePath,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { stdio: "ignore", timeout: 60 * 60 * 1000 },
    );
    if (run.status !== 0) {
      throw new Error(`ffmpeg export failed (exit ${run.status ?? "signal"})`);
    }
    const stat = fs.statSync(outPath);
    await db.insert(tandemVideoAssetFilesTable).values({
      id: randomUUID(),
      assetId: asset.id,
      kind: "EXPORT",
      storageKey: outKey,
      mimeType: "video/mp4",
      sizeBytes: stat.size,
      metadata: { format, demo: false },
    });
    return { format, demo: false, storageKey: outKey };
  }

  return { format, demo: true, storageKey: null };
}

// ---------------------------------------------------------------------------
// Checkout bundle — the background half of the external-first round-trip.
//
// `EXPORT_BUNDLE` materializes a leg's saved snapshot as a single downloadable
// zip containing all four interchange documents plus the media manifest (and,
// when the originals are on disk, the referenced media itself). Progress is
// streamed to the project room so the CheckoutPanel can show the queue state
// live instead of blocking the request. Anchored to the project, not an asset
// (job.assetId is null), so any member of the project can build a bundle.
// ---------------------------------------------------------------------------

async function processExportBundle(
  _asset: TandemVideoAsset | null,
  job: TandemVideoJob,
): Promise<{
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  leg: string;
  version: number | null;
  entries: string[];
}> {
  const params = (job.params ?? {}) as { leg?: string; includeMedia?: boolean };
  const leg = params.leg ?? "CUT";
  const checkout = await buildCheckout(job.projectId, leg);
  if (!checkout) {
    throw new Error("Save a snapshot before checking out");
  }

  const slug =
    checkout.projectName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project";
  const base = `${slug}-${leg.toLowerCase()}-v${checkout.version ?? 0}`;

  const entries: ZipEntry[] = [
    { name: `${base}.edl`, data: Buffer.from(checkout.edl, "utf8") },
    { name: `${base}.fcpxml`, data: Buffer.from(checkout.fcpxml, "utf8") },
    { name: `${base}.otio`, data: Buffer.from(checkout.otio, "utf8") },
    { name: `${base}.aaf`, data: checkout.aaf },
    {
      name: `${base}.manifest.json`,
      data: Buffer.from(
        JSON.stringify(
          {
            projectId: checkout.projectId,
            projectName: checkout.projectName,
            leg,
            version: checkout.version,
            generatedAt: new Date().toISOString(),
            media: checkout.manifest,
          },
          null,
          2,
        ),
        "utf8",
      ),
    },
  ];

  // Optionally embed the referenced originals so the bundle is self-contained
  // (the design's "zip referenced media" option). Skip missing files — the
  // manifest still lists them for the timed-grant path.
  if (params.includeMedia) {
    const assetIds = checkout.manifest.map((item) => item.assetId);
    const assets = assetIds.length
      ? await db
          .select()
          .from(tandemVideoAssetsTable)
          .where(inArray(tandemVideoAssetsTable.id, assetIds))
      : [];
    for (const asset of assets) {
      const sourcePath = path.join(uploadDir(), asset.storageKey);
      if (!fs.existsSync(sourcePath)) continue;
      entries.push({
        name: `media/${asset.fileName}`,
        data: fs.readFileSync(sourcePath),
      });
    }
  }

  emitJobProgress({
    projectId: job.projectId,
    jobId: job.id,
    type: job.type,
    status: "RUNNING",
    progress: 60,
  });

  const zip = buildZip(entries);
  fs.mkdirSync(bundleDir(), { recursive: true });
  const storageKey = `bundles/${job.id}.zip`;
  fs.writeFileSync(path.join(uploadDir(), storageKey), zip);

  emitJobProgress({
    projectId: job.projectId,
    jobId: job.id,
    type: job.type,
    status: "RUNNING",
    progress: 90,
  });

  // Record the artifact so the vault can discover it without re-probing.
  await db.insert(tandemVideoAssetFilesTable).values({
    id: randomUUID(),
    // No anchor asset for a project-scoped bundle.
    assetId: null,
    kind: "INTERCHANGE",
    storageKey,
    mimeType: "application/zip",
    sizeBytes: zip.length,
    metadata: { leg, version: checkout.version, entries: entries.map((e) => e.name) },
  });

  return {
    storageKey,
    mimeType: "application/zip",
    sizeBytes: zip.length,
    leg,
    version: checkout.version,
    entries: entries.map((e) => e.name),
  };
}

// Extracts + polishes a thumbnail frame (FFmpeg + ImageMagick when present).
async function processThumbnail(asset: TandemVideoAsset, job: TandemVideoJob): Promise<{
  timeMs: number;
  demo: boolean;
  storageKey: string | null;
}> {
  const params = (job.params ?? {}) as { timeMs?: number; assetId?: string };
  const timeMs = params.timeMs ?? 0;
  const tools = detectTools();

  // The thumbnail is cut from the master clip the Director selected.
  const sourceId = params.assetId ?? asset.id;
  const [source] =
    sourceId === asset.id
      ? [asset]
      : await db
          .select()
          .from(tandemVideoAssetsTable)
          .where(eq(tandemVideoAssetsTable.id, sourceId))
          .limit(1);
  if (!source) {
    throw new Error("Thumbnail source asset no longer exists");
  }
  const sourcePath = path.join(uploadDir(), source.storageKey);

  if (tools.ffmpeg) {
    fs.mkdirSync(proxyDir(), { recursive: true });
    const outKey = `proxies/${job.id}-thumb.jpg`;
    const outPath = path.join(uploadDir(), outKey);
    const grab = spawnSync(
      getFFmpegPath() || "ffmpeg",
      ["-y", "-ss", String(timeMs / 1000), "-i", sourcePath, "-frames:v", "1", "-q:v", "2", outPath],
      { stdio: "ignore", timeout: 120000 },
    );
    if (grab.status !== 0) {
      throw new Error(`ffmpeg thumbnail grab failed (exit ${grab.status ?? "signal"})`);
    }

    // ImageMagick polish (optional) — resize to a crisp 1280×720 cover.
    if (hasCommand("magick", ["-version"])) {
      const polished = path.join(uploadDir(), `${job.id}-thumb-polished.jpg`);
      const polish = spawnSync(
        "magick",
        [outPath, "-resize", "1280x720^", "-gravity", "center", "-extent", "1280x720", polished],
        { stdio: "ignore", timeout: 60000 },
      );
      if (polish.status === 0) {
        fs.renameSync(polished, outPath);
      }
    }

    const stat = fs.statSync(outPath);
    await db.insert(tandemVideoAssetFilesTable).values({
      id: randomUUID(),
      assetId: source.id,
      kind: "THUMBNAIL",
      storageKey: outKey,
      mimeType: "image/jpeg",
      sizeBytes: stat.size,
      metadata: { timeMs, demo: false },
    });
    return { timeMs, demo: false, storageKey: outKey };
  }

  return { timeMs, demo: true, storageKey: null };
}

// Viral reference import (M4): transcribe the reference and extract its
// pacing — scene changes (FFmpeg) + transcript section boundaries — into a
// beats structure the Architect can compare against while cutting.
async function processReferenceAnalyze(asset: TandemVideoAsset, _job: TandemVideoJob): Promise<{
  source: string;
  sections: Array<{ label: string; startMs: number; endMs: number }>;
  totalMs: number | null;
  demo: boolean;
}> {
  const tools = detectTools();
  const sourcePath = path.join(uploadDir(), asset.storageKey);
  const sections: Array<{ label: string; startMs: number; endMs: number }> = [];
  let totalMs: number | null = null;

  // Real mode: probe duration + detect scene changes with FFmpeg.
  let sceneStarts: number[] = [];
  if (tools.ffmpeg && tools.ffprobe) {
    const probe = spawnSync(
      getFFprobePath() || "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "json", sourcePath],
      { encoding: "utf8", timeout: 60000 },
    );
    if (probe.status === 0) {
      try {
        const parsed = JSON.parse(probe.stdout);
        totalMs = Math.round(Number(parsed.format?.duration ?? 0) * 1000) || null;
      } catch {
        totalMs = null;
      }
    }

    const scene = spawnSync(
      getFFmpegPath() || "ffmpeg",
      ["-i", sourcePath, "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-"],
      { encoding: "utf8", timeout: 60 * 30 * 1000 },
    );
    if (scene.status === 0 && scene.stderr) {
      const timeRegex = /pts_time:(\d+(?:\.\d+)?)/g;
      let match: RegExpExecArray | null;
      while ((match = timeRegex.exec(scene.stderr)) !== null) {
        sceneStarts.push(Math.round(Number(match[1]) * 1000));
      }
    }
  }

  // Demo fallback: size the beats from the transcript (or a default 5 min).
  if (sceneStarts.length < 2) {
    const [transcript] = await db
      .select()
      .from(tandemVideoTranscriptsTable)
      .where(eq(tandemVideoTranscriptsTable.assetId, asset.id))
      .limit(1);
    let endMs = 300000;
    if (transcript) {
      const segments = await db
        .select()
        .from(tandemVideoTranscriptSegmentsTable)
        .where(eq(tandemVideoTranscriptSegmentsTable.transcriptId, transcript.id))
        .orderBy(desc(tandemVideoTranscriptSegmentsTable.endMs))
        .limit(1);
      if (segments[0]) endMs = Math.max(segments[0].endMs, 30000);
    }
    totalMs = totalMs ?? endMs;
    const frame = endMs / 5;
    sceneStarts = [0, frame, frame * 2, frame * 3, frame * 4, frame * 5];
  }

  const sectionLabels = ["Hook", "Setup", "Core", "Payoff", "CTA"];
  const total = totalMs ?? 300000;
  const boundaries = sceneStarts;
  for (let i = 0; i < sectionLabels.length; i++) {
    const startMs = boundaries[Math.min(i * Math.max(1, Math.floor(boundaries.length / sectionLabels.length)), boundaries.length - 1)] ?? (i * total) / sectionLabels.length;
    const endMs = boundaries[Math.min((i + 1) * Math.max(1, Math.floor(boundaries.length / sectionLabels.length)), boundaries.length - 1)] ?? ((i + 1) * total) / sectionLabels.length;
    sections.push({ label: sectionLabels[i], startMs, endMs: Math.max(endMs, startMs + 500) });
  }

  // Upsert the reference row (unique on assetId).
  const [existing] = await db
    .select()
    .from(tandemVideoReferencesTable)
    .where(eq(tandemVideoReferencesTable.assetId, asset.id))
    .limit(1);
  const pacing = { sections, totalMs, source: tools.ffmpeg ? "WHISPER+FFMPEG" : "DEMO" };
  if (existing) {
    await db
      .update(tandemVideoReferencesTable)
      .set({ status: "READY", pacing, error: null, updatedAt: new Date() })
      .where(eq(tandemVideoReferencesTable.id, existing.id));
  } else {
    await db.insert(tandemVideoReferencesTable).values({
      id: randomUUID(),
      assetId: asset.id,
      status: "READY",
      pacing,
    });
  }

  return { source: pacing.source, sections, totalMs, demo: !tools.ffmpeg };
}

const PROCESSORS: Record<
  string,
  (asset: TandemVideoAsset | null, job: TandemVideoJob) => Promise<unknown>
> = {
  PROXY: processProxy,
  TRANSCRIBE: processTranscribe,
  SYNC: processSync,
  RENDER: processRender,
  AUDIO: processAudio,
  EXPORT: processExport,
  THUMBNAIL: processThumbnail,
  REFERENCE_ANALYZE: processReferenceAnalyze,
  EXPORT_BUNDLE: processExportBundle,
};

// ---------------------------------------------------------------------------
// Queue loop
// ---------------------------------------------------------------------------

/**
 * Runs one job end-to-end: claims the row (RUNNING), resolves the asset,
 * executes the processor, and finalizes the row (SUCCEEDED / FAILED).
 *
 * Throws on failure after the row is marked FAILED so BullMQ can retry with
 * backoff (see queues.ts); the in-process polling fallback wraps it in
 * claimAndRun and swallows. Both paths share this code, so the row contract
 * is identical no matter which claim layer is in use.
 */
export async function runJob(job: TandemVideoJob): Promise<void> {
  await db
    .update(tandemVideoJobsTable)
    .set({ status: "RUNNING", startedAt: new Date(), attempts: job.attempts + 1 })
    .where(eq(tandemVideoJobsTable.id, job.id));
  emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "RUNNING" });

  // Project-scoped jobs (EXPORT_BUNDLE checkout) have no anchor asset.
  let asset: TandemVideoAsset | null = null;
  if (job.assetId) {
    [asset] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.id, job.assetId))
      .limit(1);

    if (!asset) {
      const message = "Asset no longer exists";
      await db
        .update(tandemVideoJobsTable)
        .set({ status: "FAILED", error: message, finishedAt: new Date() })
        .where(eq(tandemVideoJobsTable.id, job.id));
      emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "FAILED", error: message });
      throw new Error(message);
    }
  }

  const processor = PROCESSORS[job.type];
  if (!processor) {
    const message = `Unknown job type: ${job.type}`;
    await db
      .update(tandemVideoJobsTable)
      .set({ status: "FAILED", error: message, finishedAt: new Date() })
      .where(eq(tandemVideoJobsTable.id, job.id));
    emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "FAILED", error: message });
    throw new Error(message);
  }

  try {
    const result = await processor(asset, job);
    await db
      .update(tandemVideoJobsTable)
      .set({ status: "SUCCEEDED", result, finishedAt: new Date() })
      .where(eq(tandemVideoJobsTable.id, job.id));
    emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "SUCCEEDED" });

    // Record the produced artifact (proxy file) as an asset file row so the
    // vault and studio can discover it without re-probing. Renders record
    // their own file rows inside the processor; EXPORT_BUNDLE records its
    // bundle row inside the processor too.
    if (job.type === "PROXY") {
      const proxy = result as ProxyResult;
      await db.insert(tandemVideoAssetFilesTable).values({
        id: randomUUID(),
        assetId: asset!.id,
        kind: "PROXY",
        storageKey: proxy.storageKey,
        mimeType: proxy.mimeType,
        sizeBytes: proxy.sizeBytes,
        metadata: proxy.metadata,
      });
    }

    if (asset) await markAssetProcessedIfDone(asset.id);
    logger.info({ jobId: job.id, type: job.type, assetId: asset?.id ?? null }, "Video job succeeded");
  } catch (error) {
    await db
      .update(tandemVideoJobsTable)
      .set({ status: "FAILED", error: (error as Error).message, finishedAt: new Date() })
      .where(eq(tandemVideoJobsTable.id, job.id));
    emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "FAILED", error: (error as Error).message });
    logger.error({ jobId: job.id, type: job.type, err: error }, "Video job failed");
    throw error;
  }
}

/** Polling-loop entry: run a job but never throw (the loop keeps going). */
async function claimAndRun(job: TandemVideoJob): Promise<void> {
  try {
    await runJob(job);
  } catch (error) {
    logger.error({ jobId: job.id, err: error }, "Worker cycle error");
  }
}

async function markAssetProcessedIfDone(assetId: string): Promise<void> {
  const remaining = await db
    .select()
    .from(tandemVideoJobsTable)
    .where(
      and(
        eq(tandemVideoJobsTable.assetId, assetId),
        inArray(tandemVideoJobsTable.status, ["QUEUED", "RUNNING"]),
      ),
    );
  if (remaining.length === 0) {
    const [asset] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.id, assetId))
      .limit(1);
    await db
      .update(tandemVideoAssetsTable)
      .set({ status: "PROCESSED" })
      .where(eq(tandemVideoAssetsTable.id, assetId));
    if (asset) {
      emitToProject(asset.projectId, "asset.processed", {
        projectId: asset.projectId,
        assetId,
      });
    }
  }
}

/** Runs one polling cycle: claims up to N queued jobs and processes them. */
export async function runWorkerCycle(): Promise<void> {
  const jobs = await db
    .select()
    .from(tandemVideoJobsTable)
    .where(eq(tandemVideoJobsTable.status, "QUEUED"))
    .orderBy(asc(tandemVideoJobsTable.createdAt))
    .limit(JOB_BATCH_SIZE);

  for (const job of jobs) {
    try {
      await claimAndRun(job);
    } catch (error) {
      logger.error({ jobId: job.id, err: error }, "Worker cycle error");
    }
  }
}

let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Starts job processing. Idempotent. Returns a stop function.
 *
 * - BullMQ mode (REDIS_URL set): the worker processes consume the queues;
 *   the API only bridges their Redis progress to Socket.IO. No polling here
 *   — otherwise every job would run twice.
 * - Fallback mode (no Redis, e.g. local dev or isolated tests): the classic
 *   in-process polling loop claims QUEUED rows directly.
 */
export function startVideoWorker(intervalMs = POLL_INTERVAL_MS): () => void {
  if (bullmqEnabled()) {
    attachQueueEventBridge();
    logger.info(
      "BullMQ mode — worker processes handle video jobs; API bridges progress to Socket.IO",
    );
    return () => {};
  }
  if (_timer) return () => clearInterval(_timer!);
  _timer = setInterval(() => {
    void runWorkerCycle();
  }, intervalMs);
  _timer.unref?.();
  return () => {
    if (_timer) {
      clearInterval(_timer);
      _timer = null;
    }
  };
}
