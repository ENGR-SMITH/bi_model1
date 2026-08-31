// ---------------------------------------------------------------------------
// Cloudflare R2 object storage adapter.
//
// R2 is S3-compatible, so this wraps the AWS SDK v3 (`S3Client`) pointed at
// the R2 endpoint. The server only ever generates short-lived presigned URLs
// and never touches the file bytes: the browser / desktop agent PUTs straight
// to R2 and streams GETs straight from Cloudflare's edge ($0 egress).
//
// The adapter is a thin seam over a store *interface* so tests can inject an
// in-memory fake (ObjectStore) that shares exactly the same code path; when
// the R2 env vars are absent (local dev / tests) the adapter falls back to
// reading/writing the existing local disk under `uploadDir()` — so the
// platform keeps running with zero R2 configuration and all existing tests
// stay green.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { uploadDir } from "./worker";

// ---------------------------------------------------------------------------
// Storage key layout (mirrors the playbook) — the existing relative `storageKey`
// values (e.g. "proxies/{id}.mp4") are namespaced under `projects/{projectId}/`
// so every project's objects are isolated in one bucket.
// ---------------------------------------------------------------------------
export function r2KeyFor(projectId: string, storageKey: string): string {
  return `projects/${projectId}/${storageKey.replace(/^[/\\]+/, "")}`;
}

export function r2Configured(): boolean {
  return Boolean(
    process.env.CF_ACCOUNT_ID &&
      process.env.CF_R2_ACCESS_KEY &&
      process.env.CF_R2_SECRET_KEY &&
      process.env.CF_R2_BUCKET,
  );
}

export function r2Bucket(): string {
  return process.env.CF_R2_BUCKET || "tandem-media";
}

// ---------------------------------------------------------------------------
// Interface everything (routes + worker + tests) depends on.
// ---------------------------------------------------------------------------
export interface ObjectStore {
  /** Upload a local file (already on disk) to the object store. */
  put(projectId: string, storageKey: string, filePath: string, contentType: string): Promise<{ sizeBytes: number }>;
  /** Download an object into a local file path. */
  getToFile(projectId: string, storageKey: string, filePath: string): Promise<void>;
  /** True when the object exists. */
  exists(projectId: string, storageKey: string): Promise<boolean>;
  /** 15-minute presigned GET URL, or null when serving locally. */
  getUrl(projectId: string, storageKey: string): Promise<string | null>;
  /** 15-minute presigned PUT URL, or null when uploading locally. */
  putUrl(projectId: string, storageKey: string, contentType: string, contentLength: number): Promise<string | null>;
  /** Delete an object (best-effort). */
  delete(projectId: string, storageKey: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Cloudflare R2 (AWS SDK v3) backing implementation.
// ---------------------------------------------------------------------------
class R2Store implements ObjectStore {
  private client: S3Client;
  private bucket = r2Bucket();

  constructor() {
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CF_R2_ACCESS_KEY!,
        secretAccessKey: process.env.CF_R2_SECRET_KEY!,
      },
    });
  }

  private key(projectId: string, storageKey: string): string {
    return r2KeyFor(projectId, storageKey);
  }

  async put(projectId: string, storageKey: string, filePath: string, contentType: string): Promise<{ sizeBytes: number }> {
    const stat = fs.statSync(filePath);
    const input: PutObjectCommandInput = {
      Bucket: this.bucket,
      Key: this.key(projectId, storageKey),
      ContentType: contentType || "application/octet-stream",
      Metadata: {
        "project-id": projectId,
        "storage-key": storageKey,
      },
    };
    await this.client.send(new PutObjectCommand({ ...input, Body: fs.createReadStream(filePath) }));
    return { sizeBytes: stat.size };
  }

  async getToFile(projectId: string, storageKey: string, filePath: string): Promise<void> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(projectId, storageKey) }),
    );
    const body = out.Body as NodeJS.ReadableStream | undefined;
    if (!body) throw new Error(`Object ${storageKey} has no body`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const chunks: Buffer[] = [];
      body.on("data", (c: Buffer) => chunks.push(c));
      body.on("end", () => {
        fs.writeFileSync(filePath, Buffer.concat(chunks));
        resolve();
      });
      body.on("error", reject);
    });
  }

  async exists(projectId: string, storageKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(projectId, storageKey) }));
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(projectId: string, storageKey: string): Promise<string | null> {
    // No restrictive headers — the browser must be able to send Range requests
    // for video seeking (the playbook's key gotcha).
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: this.key(projectId, storageKey) });
    return getSignedUrl(this.client, command, { expiresIn: 900 });
  }

  async putUrl(projectId: string, storageKey: string, contentType: string, contentLength: number): Promise<string | null> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(projectId, storageKey),
      ContentType: contentType || "application/octet-stream",
      ContentLength: contentLength,
    });
    return getSignedUrl(this.client, command, { expiresIn: 900 });
  }

  async delete(projectId: string, storageKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(projectId, storageKey) }));
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Local-disk backing implementation (no R2 configured). Serves the same
// `projects/{projectId}/{storageKey}` namespace under `uploadDir()` so reads
// and writes use the identical key layout.
// ---------------------------------------------------------------------------
class LocalDiskStore implements ObjectStore {
  private fileKey(projectId: string, storageKey: string): string {
    return path.join(uploadDir(), "objects", projectId, storageKey);
  }

  async put(projectId: string, storageKey: string, filePath: string): Promise<{ sizeBytes: number }> {
    const out = this.fileKey(projectId, storageKey);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(filePath, out);
    return { sizeBytes: fs.statSync(out).size };
  }

  async getToFile(projectId: string, storageKey: string, filePath: string): Promise<void> {
    const src = this.fileKey(projectId, storageKey);
    if (!fs.existsSync(src)) throw new Error(`Object ${storageKey} is missing`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.copyFileSync(src, filePath);
  }

  async exists(projectId: string, storageKey: string): Promise<boolean> {
    return fs.existsSync(this.fileKey(projectId, storageKey));
  }

  async getUrl(): Promise<string | null> {
    // No presigned URL in local mode — the routes fall back to streaming from
    // disk directly. Returning null signals that.
    return null;
  }

  async putUrl(): Promise<string | null> {
    return null;
  }

  async delete(projectId: string, storageKey: string): Promise<void> {
    try {
      fs.unlinkSync(this.fileKey(projectId, storageKey));
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Active store + test injection seam.
// ---------------------------------------------------------------------------
let _store: ObjectStore | null = null;

/** The configured store. Callers must not cache it across env changes. */
export function getStore(): ObjectStore {
  if (_store) return _store;
  return r2Configured() ? new R2Store() : new LocalDiskStore();
}

/** Test seam: replace the active store with a fake (or reset via null). */
export function _setStore(store: ObjectStore | null): void {
  _store = store;
}

/**
 * Upload a freshly-produced artifact (already on disk at `localPath`, keyed by
 * `storageKey`) into the active object store when R2 is configured. Returns the
 * storage provider to record on the asset/asset-file row ("r2" or "local").
 * Workers call this after writing a proxy/render/export/bundle so the read
 * routes know whether to presign a URL or stream from disk.
 */
export async function persistArtifact(
  projectId: string,
  storageKey: string,
  localPath: string,
  mimeType: string,
): Promise<"r2" | "local"> {
  if (!r2Configured()) return "local";
  await getStore().put(projectId, storageKey, localPath, mimeType);
  return "r2";
}

export { randomUUID };