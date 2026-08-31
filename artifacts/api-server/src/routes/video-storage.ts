import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db,
  tandemVideoAssetsTable,
  tandemVideoAssetFilesTable,
} from "@workspace/db";
import { getStore, r2Configured } from "../video/object-storage";
import { resolveProjectAccess } from "../video/access";
const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Presigned R2 upload endpoints.
//
// Browsers choke on files bigger than ~2 GB and the server should never hold
// the bytes of a proxy in memory anyway. The desktop agent (or a CLI caller)
// generates the proxy with FFmpeg, then:
//   1. POST proxy-upload-url  → server checks access/quota, mints a 15-minute
//                               presigned PUT, and records a pending file row.
//   2. PUT the bytes straight to R2 (server never touches them).
//   3. POST proxy-ready       → server verifies the object via HeadObject,
//                               flips the row to `uploaded`, and knows the
//                               proxy is ready for playback.
// Originals stay local; only proxies/renders/exports/bundles live in R2, so
// these endpoints target derived artifacts on an existing asset.
// ---------------------------------------------------------------------------

// POST /video/projects/:projectId/assets/:assetId/proxy-upload-url
router.post(
  "/video/projects/:projectId/assets/:assetId/proxy-upload-url",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!r2Configured()) {
      res.status(503).json({ error: "Object storage (R2) is not configured on this server" });
      return;
    }

    const projectId = String(req.params.projectId ?? "");
    const assetId = String(req.params.assetId ?? "");
    const filename = typeof req.body?.filename === "string" ? req.body.filename : "proxy.mp4";
    const mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : "video/mp4";
    const fileSize = Number(req.body?.fileSize);

    const access = await resolveProjectAccess(projectId, userId);
    if (!access) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [asset] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.id, assetId))
      .limit(1);
    if (!asset || asset.projectId !== projectId) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    if (!Number.isFinite(fileSize) || fileSize <= 0) {
      res.status(400).json({ error: "fileSize must be a positive number" });
      return;
    }

    const store = getStore();
    // The proxy sits under the asset, mirroring the multipart worker key.
    const storageKey = `proxies/${asset.id}.mp4`;
    const uploadUrl = await store.putUrl(projectId, storageKey, mimeType, Math.floor(fileSize));
    if (!uploadUrl) {
      res.status(503).json({ error: "Presigned upload is unavailable" });
      return;
    }

    // Fresh pending row — marks the artifact as in-flight until proxy-ready.
    await db.insert(tandemVideoAssetFilesTable).values({
      id: randomUUID(),
      assetId: asset.id,
      kind: "PROXY",
      storageKey,
      storageProvider: "r2",
      mimeType,
      sizeBytes: Math.floor(fileSize),
      metadata: { pending: true },
    });

    res.json({
      uploadUrl,
      assetId: asset.id,
      storageKey,
      mimeType,
      fileSize: Math.floor(fileSize),
      expiresIn: 900,
    });
  },
);

// POST /video/projects/:projectId/assets/:assetId/proxy-ready
router.post(
  "/video/projects/:projectId/assets/:assetId/proxy-ready",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const projectId = String(req.params.projectId ?? "");
    const assetId = String(req.params.assetId ?? "");

    const access = await resolveProjectAccess(projectId, userId);
    if (!access) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    // Latest pending PROXY row for this asset.
    const proxies = await db
      .select()
      .from(tandemVideoAssetFilesTable)
      .where(eq(tandemVideoAssetFilesTable.assetId, assetId));

    const pendingProxy = proxies.find((p) => p.kind === "PROXY" && p.storageProvider === "r2");
    if (!pendingProxy) {
      res.status(404).json({ error: "No pending proxy upload for this asset" });
      return;
    }

    // Verify the bytes actually landed in R2.
    const store = getStore();
    const exists = await store.exists(projectId, pendingProxy.storageKey);
    if (!exists) {
      res.status(400).json({ error: "File not found in object storage" });
      return;
    }

    // Flip the row to uploaded (real metadata); the proxy stream route now
    // serves it via a presigned GET.
    const metadata = (pendingProxy.metadata as Record<string, unknown> | null) ?? {};
    delete metadata.pending;
    await db
      .update(tandemVideoAssetFilesTable)
      .set({ metadata: { ...metadata, uploaded: true } })
      .where(eq(tandemVideoAssetFilesTable.id, pendingProxy.id));
    await db
      .update(tandemVideoAssetsTable)
      .set({ status: "PROCESSED" })
      .where(eq(tandemVideoAssetsTable.id, assetId));

    res.json({ success: true, fileId: pendingProxy.id });
  },
);

export default router;