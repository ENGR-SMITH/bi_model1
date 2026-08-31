import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

export interface Project {
  id: string;
  name: string;
  status: string;
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

  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("GET", "/video/projects");
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

  /** PUT the proxy bytes straight to R2 via the presigned URL (no server hop). */
  async putToPresigned(uploadUrl: string, localPath: string, mimeType: string): Promise<void> {
    const fileStream = fs.createReadStream(localPath);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      // @ts-expect-error undici accepts a web ReadableStream; Node streams work for large bodies
      body: fileStream as unknown as Readable,
      duplex: "half",
    });
    void pipeline;
    if (!res.ok) {
      throw new Error(`R2 PUT failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
  }
}

export { path };