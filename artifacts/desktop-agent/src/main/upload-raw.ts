// Streaming multipart upload of a local raw file into the vault.
//
// The desktop agent's job is now "get footage from your PC into the vault",
// so it streams the selected file straight to the same endpoint the browser
// upload uses (POST /api/video/projects/:id/assets, multipart "file" + "kind").
// The server writes it to the processing disk and runs the normal pipeline
// (hash/dedupe, proxy, transcript), exactly like a browser upload — the only
// difference is there is no 500 MB cap on this side (the server cap is 10 GB).
//
// The body is streamed from disk (backpressure-aware) so multi-GB files never
// get buffered in memory.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { once } from "node:events";

const BOUNDARY = `----tandem-agent-${randomBytes(12).toString("hex")}`;
const CRLF = "\r\n";

const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aif", ".aiff", ".opus"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mpg", ".mpeg"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mpg": "video/mpeg",
  ".mpeg": "video/mpeg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".opus": "audio/opus",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};

// The vault kind a dropped file lands under: audio -> RAW_AUDIO, images ->
// THUMBNAIL_DESIGN (the Thumbnail desk's default), everything else ->
// RAW_VIDEO. The role gate decides who may actually upload each kind.
export function kindForFile(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (AUDIO_EXTS.has(ext)) return "RAW_AUDIO";
  if (IMAGE_EXTS.has(ext)) return "THUMBNAIL_DESIGN";
  return "RAW_VIDEO";
}

export function mimeForFile(fileName: string): string {
  return MIME_BY_EXT[path.extname(fileName).toLowerCase()] || "application/octet-stream";
}

export interface UploadRawOptions {
  apiBaseUrl: string;
  token: string;
  projectId: string;
  /** Absolute path of the local raw file. */
  filePath: string;
  /** Optional note to the Captain — travels with the submission for review. */
  note?: string;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

export interface UploadRawResult {
  ok: true;
  assetId: string;
  fileName: string;
  status: string;
  /** Set on submit-for-review uploads: the review submission now on the
      Captain's queue (approve lands the file in the vault). */
  submissionId?: string;
  review?: boolean;
}

/** Multipart header bytes for one part. */
function partHeader(name: string, filename: string | null, mimeType: string): Buffer {
  const disposition = filename
    ? `Content-Disposition: form-data; name="${name}"; filename="${filename.replace(/"/g, "")}"`
    : `Content-Disposition: form-data; name="${name}"`;
  const lines = filename
    ? [disposition, `Content-Type: ${mimeType}`, "", ""]
    : [disposition, "", ""];
  return Buffer.from(`--${BOUNDARY}${CRLF}${lines.join(CRLF)}`, "utf8");
}

export async function uploadRawMultipart(opts: UploadRawOptions): Promise<UploadRawResult> {
  const fileName = path.basename(opts.filePath);
  const mimeType = mimeForFile(opts.filePath);
  const kind = kindForFile(opts.filePath);
  const fileSize = fs.statSync(opts.filePath).size;

  const url = new URL(`${opts.apiBaseUrl.replace(/\/+$/, "")}/api/video/projects/${opts.projectId}/assets`);
  const transport = url.protocol === "https:" ? https : http;

  // Submit-for-review: the agent never writes straight to the vault anymore —
  // the file + note are handed to the Captain as a review submission and only
  // an approval moves them into the vault.
  const note = (opts.note ?? "").slice(0, 2000);
  const kindHeader = partHeader("kind", null, "");
  const reviewHeader = partHeader("review", null, "");
  const noteHeader = partHeader("note", null, "");
  const fileHeader = partHeader("file", fileName, mimeType);
  const footer = Buffer.from(`${CRLF}--${BOUNDARY}--${CRLF}`, "utf8");
  const bodyLength =
    kindHeader.length +
    Buffer.byteLength(kind) +
    reviewHeader.length +
    Buffer.byteLength("true") +
    noteHeader.length +
    Buffer.byteLength(note) +
    fileHeader.length +
    fileSize +
    footer.length;

  let sent = 0;
  let lastEmit = 0;
  const report = (bytes: number) => {
    sent = bytes;
    const now = Date.now();
    if (opts.onProgress && now - lastEmit > 150) {
      lastEmit = now;
      opts.onProgress(Math.min(sent, bodyLength), bodyLength);
    }
  };

  const responseBody = await new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
          "Content-Length": bodyLength,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);

    req.write(kindHeader);
    req.write(kind);
    req.write(reviewHeader);
    req.write("true");
    req.write(noteHeader);
    req.write(note);
    req.write(fileHeader);

    // Stream the file from disk, honoring backpressure, then close the body.
    const stream = fs.createReadStream(opts.filePath);
    stream.on("error", (err) => {
      req.destroy(err);
      reject(err);
    });
    stream.on("data", (chunk: Buffer) => {
      report(sent + chunk.length);
      if (!req.write(chunk)) {
        stream.pause();
        void once(req, "drain").then(() => stream.resume());
      }
    });
    stream.on("end", () => {
      req.end(footer);
      report(bodyLength);
    });
  });

  if (responseBody.status < 200 || responseBody.status >= 300) {
    let message = `Upload failed (${responseBody.status}).`;
    try {
      const data = JSON.parse(responseBody.text) as { error?: string };
      if (typeof data?.error === "string" && data.error) message = data.error;
    } catch {
      // Non-JSON body — keep the generic message.
    }
    const error = new Error(`API POST ${url.pathname} failed (${responseBody.status}): ${message}`);
    (error as Error & { status?: number }).status = responseBody.status;
    throw error;
  }

  let root: { id?: string; asset?: { id?: string }; status?: string; submissionId?: string; review?: boolean } = {};
  try {
    root = JSON.parse(responseBody.text) as {
      id?: string;
      asset?: { id?: string };
      status?: string;
      submissionId?: string;
      review?: boolean;
    };
  } catch {
    throw new Error("The upload returned an unreadable response.");
  }
  const assetId = root.asset?.id ?? root.id ?? "";
  if (!assetId) throw new Error("The upload did not return a vault asset id.");
  return {
    ok: true,
    assetId,
    fileName,
    status: root.status ?? "UPLOADED",
    submissionId: root.submissionId,
    review: Boolean(root.review),
  };
}