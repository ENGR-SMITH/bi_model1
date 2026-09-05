import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import type { Readable } from "node:stream";

export interface Project {
  id: string;
  name: string;
  status: string;
}

export interface ProjectDetail {
  id: string;
  name: string;
  status: string;
  /** The workspace channel this project lives in (null for legacy unlinked projects). */
  channelId: string | null;
  /** The viewer's roles in this project, e.g. ["VIDEO", "THUMBNAIL"]. */
  myRoles: string[];
}

/** A Creator Den channel the signed-in user is on (owned + editor mirrors). */
export interface ChannelItem {
  id: string;
  name: string | null;
  youtubeTitle: string | null;
  youtubeAvatarUrl: string | null;
  myRole: "OWNER" | "EDITOR";
}

export interface Asset {
  id: string;
  fileName: string;
  kind: string;
  status: string;
}

export interface PresignedMint {
  uploadUrl: string;
  assetId: string;
  storageKey: string;
  mimeType: string;
  fileSize: number;
}

const API_PREFIX = "/api";

export class ApiClient {
  private token: string;
  private baseUrl: string;

  constructor(apiBaseUrl: string, token: string) {
    this.baseUrl = apiBaseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.baseUrl + API_PREFIX + urlPath, {
      method,
      headers,
      body: payload,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${method} ${urlPath} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  /** The user's projects. Without a channel it lists every owned/member
   * project (including legacy unlinked ones); with one it is scoped to that
   * channel exactly like Creator Den (owner sees all, editors only their own
   * memberships there). */
  async listProjects(channelId?: string): Promise<Project[]> {
    const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : "";
    return this.request<Project[]>("GET", `/video/projects${query}`);
  }

  /** The channels the signed-in user belongs to (for the Channel dropdown). */
  async listChannels(): Promise<ChannelItem[]> {
    return this.request<ChannelItem[]>("GET", "/channels");
  }

  /** Project detail — includes the viewer's own roles (`myRoles`). */
  async getProject(projectId: string): Promise<ProjectDetail> {
    return this.request<ProjectDetail>("GET", `/video/projects/${projectId}`);
  }

  async listAssets(projectId: string): Promise<Asset[]> {
    return this.request<Asset[]>("GET", `/video/projects/${projectId}/assets`);
  }

  /** Usually 201; lists return an array but assets return a single object. */
  async listAssetsRaw(projectId: string): Promise<Asset[]> {
    const res = await this.request<unknown>("GET", `/video/projects/${projectId}/assets`);
    return Array.isArray(res) ? (res as Asset[]) : [];
  }

  async mintProxyUpload(
    projectId: string,
    assetId: string,
    filename: string,
    fileSize: number,
    mimeType: string,
  ): Promise<PresignedMint> {
    return this.request<PresignedMint>(
      "POST",
      `/video/projects/${projectId}/assets/${assetId}/proxy-upload-url`,
      { filename, fileSize, mimeType },
    );
  }

  async confirmProxy(projectId: string, assetId: string): Promise<void> {
    await this.request("POST", `/video/projects/${projectId}/assets/${assetId}/proxy-ready`);
  }

  /**
   * PUT the proxy bytes straight to R2 via the presigned URL (no server hop).
   * Reports upload progress through `onProgress` by counting bytes as they are
   * read off disk into the request body.
   */
  async putToPresigned(
    uploadUrl: string,
    localPath: string,
    mimeType: string,
    onProgress?: (sentBytes: number, totalBytes: number) => void,
  ): Promise<void> {
    const totalBytes = fs.statSync(localPath).size;
    let sentBytes = 0;
    let lastEmit = 0;

    const counter = new Transform({
      transform(chunk: Buffer, _enc: string, cb: (err?: Error | null, data?: Buffer) => void) {
        sentBytes += chunk.length;
        const now = Date.now();
        if (onProgress && now - lastEmit > 150) {
          lastEmit = now;
          onProgress(Math.min(sentBytes, totalBytes), totalBytes);
        }
        cb(null, chunk);
      },
    });

    const fileStream = fs.createReadStream(localPath).pipe(counter);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      // @ts-expect-error undici accepts a web ReadableStream; Node streams work for large bodies
      body: fileStream as unknown as Readable,
      duplex: "half",
    });
    if (!res.ok) {
      throw new Error(`R2 PUT failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    onProgress?.(totalBytes, totalBytes);
  }
}

export { path };