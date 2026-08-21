import { getAuth } from "@clerk/express";
import {
  db,
  tandemVideoAssetFilesTable,
  tandemVideoAssetsTable,
  tandemVideoDownloadsTable,
  tandemVideoGrantsTable,
  tandemVideoJobsTable,
  tandemVideoMembersTable,
  tandemVideoProjectsTable,
  type TandemVideoMember,
} from "@workspace/db";
import { gt, isNull } from "drizzle-orm";
import {
  DownloadVideoFileParams,
  ListVideoDownloadsParams,
  ListVideoDownloadsResponse,
  QueueAudioPassBody,
  QueueAudioPassParams,
  QueueAudioPassResponse,
  QueueVideoExportBody,
  QueueVideoExportParams,
  QueueVideoExportResponse,
  QueueVideoThumbnailBody,
  QueueVideoThumbnailParams,
  QueueVideoThumbnailResponse,
} from "@workspace/api-zod";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { uploadDir } from "../video/worker";
import { logger } from "../lib/logger";
import { emitJobProgress } from "../realtime";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// M3 — the finish line. Sound Designer and Motion & Color actions plus the
// Lock release: once the Captain approves the FINISH leg, the project flips
// to RELEASED and files become downloadable (every download is audited).
// ---------------------------------------------------------------------------

const LEG_ROLES: Record<string, string> = {
  SELECTS: "ARCHITECT",
  CUT: "VISUAL_EDITOR",
  SOUND: "SOUND_DESIGNER",
  FINISH: "MOTION_COLOR",
  THUMBNAIL: "THUMBNAIL_DESIGNER",
} as const;

async function requireMember(
  projectId: string,
  userId: string,
): Promise<TandemVideoMember | null> {
  const [member] = await db
    .select()
    .from(tandemVideoMembersTable)
    .where(
      and(
        eq(tandemVideoMembersTable.projectId, projectId),
        eq(tandemVideoMembersTable.userId, userId),
        eq(tandemVideoMembersTable.status, "ACTIVE"),
      ),
    )
    .limit(1);
  return member ?? null;
}

async function requireLegEditor(
  projectId: string,
  leg: string,
  userId: string,
): Promise<TandemVideoMember | null> {
  const member = await requireMember(projectId, userId);
  if (!member) return null;
  if (member.role === "CAPTAIN") return member;
  return member.role === LEG_ROLES[leg] ? member : null;
}

// POST /video/projects/:projectId/audio — queue an audio pass for the SOUND
// leg (noise reduction, EQ, ducking, leveling).
router.post(
  "/video/projects/:projectId/audio",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = QueueAudioPassParams.safeParse(req.params);
    const body = QueueAudioPassBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid audio pass request" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, "SOUND", userId);
    if (!member) {
      res.status(403).json({ error: "Only the Sound Designer (or the Captain) can run audio passes" });
      return;
    }

    // Apply to the head clip of the SOUND timeline if one exists, else the
    // project's first asset — the job needs a concrete source file.
    let assetId = body.data.assetId ?? "";
    if (!assetId) {
      const [asset] = await db
        .select()
        .from(tandemVideoAssetsTable)
        .where(eq(tandemVideoAssetsTable.projectId, params.data.projectId))
        .orderBy(desc(tandemVideoAssetsTable.createdAt))
        .limit(1);
      assetId = asset?.id ?? "";
    }
    if (!assetId) {
      res.status(400).json({ error: "No footage in the vault to process" });
      return;
    }

    const [job] = await db
      .insert(tandemVideoJobsTable)
      .values({
        id: randomUUID(),
        projectId: params.data.projectId,
        assetId,
        type: "AUDIO",
        params: { action: body.data.action },
      })
      .returning();
    emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "QUEUED" });

    res.status(201).json(QueueAudioPassResponse.parse(job));
  },
);

// POST /video/projects/:projectId/exports — queue multi-format exports of the
// FINISH master (16:9 / 9:16 / 1:1). One job per format.
router.post(
  "/video/projects/:projectId/exports",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = QueueVideoExportParams.safeParse(req.params);
    const body = QueueVideoExportBody.safeParse(req.body);
    if (!params.success || !body.success || body.data.formats.length === 0) {
      res.status(400).json({ error: "Pick at least one export format" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, "FINISH", userId);
    if (!member) {
      res.status(403).json({ error: "Only the Motion & Color Director (or the Captain) can export" });
      return;
    }

    const [asset] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.projectId, params.data.projectId))
      .orderBy(desc(tandemVideoAssetsTable.createdAt))
      .limit(1);
    if (!asset) {
      res.status(400).json({ error: "No footage in the vault to export" });
      return;
    }

    const jobs = [];
    for (const format of body.data.formats) {
      const [job] = await db
        .insert(tandemVideoJobsTable)
        .values({
          id: randomUUID(),
          projectId: params.data.projectId,
          assetId: asset.id,
          type: "EXPORT",
          params: { format },
        })
        .returning();
      jobs.push(job);
      emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "QUEUED" });
    }

    res.status(201).json(QueueVideoExportResponse.parse(jobs[0]));
  },
);

// POST /video/projects/:projectId/thumbnail — queue thumbnail frame extraction.
router.post(
  "/video/projects/:projectId/thumbnail",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = QueueVideoThumbnailParams.safeParse(req.params);
    const body = QueueVideoThumbnailBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid thumbnail request" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, "FINISH", userId);
    if (!member) {
      res.status(403).json({ error: "Only the Motion & Color Director (or the Captain) can set a thumbnail" });
      return;
    }

    const [asset] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.id, body.data.assetId))
      .limit(1);
    if (!asset || asset.projectId !== params.data.projectId) {
      res.status(400).json({ error: "Thumbnail source must belong to this project" });
      return;
    }

    const [job] = await db
      .insert(tandemVideoJobsTable)
      .values({
        id: randomUUID(),
        projectId: params.data.projectId,
        assetId: asset.id,
        type: "THUMBNAIL",
        params: { assetId: asset.id, timeMs: body.data.timeMs },
      })
      .returning();
    emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "QUEUED" });

    res.status(201).json(QueueVideoThumbnailResponse.parse(job));
  },
);

// GET /video/projects/:projectId/files/:fileId/download — the Lock release.
// Only once the project is RELEASED can members download files; every
// download is written to the audit trail.
router.get(
  "/video/projects/:projectId/files/:fileId/download",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = DownloadVideoFileParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid file id" });
      return;
    }

    const member = await requireMember(params.data.projectId, userId);
    if (!member) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [project] = await db
      .select()
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.id, params.data.projectId))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.status !== "RELEASED") {
      // M4: a temporary grant from the Captain bypasses the Lock while active.
      const [grant] = await db
        .select()
        .from(tandemVideoGrantsTable)
        .where(
          and(
            eq(tandemVideoGrantsTable.projectId, project.id),
            eq(tandemVideoGrantsTable.fileId, params.data.fileId),
            eq(tandemVideoGrantsTable.memberId, userId),
            isNull(tandemVideoGrantsTable.revokedAt),
            gt(tandemVideoGrantsTable.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!grant) {
        res.status(403).json({
          error: "The Lock is still on — downloads open once the Captain approves the final master",
        });
        return;
      }
    }

    // The fileId may be an AssetFile row (proxy/export/thumbnail) or a raw
    // asset id (the locked original). Resolve either.
    const [file] = await db
      .select()
      .from(tandemVideoAssetFilesTable)
      .where(eq(tandemVideoAssetFilesTable.id, params.data.fileId))
      .limit(1);

    let asset;
    if (file) {
      [asset] = await db
        .select()
        .from(tandemVideoAssetsTable)
        .where(eq(tandemVideoAssetsTable.id, file.assetId))
        .limit(1);
    } else {
      [asset] = await db
        .select()
        .from(tandemVideoAssetsTable)
        .where(eq(tandemVideoAssetsTable.id, params.data.fileId))
        .limit(1);
    }

    if (!asset || asset.projectId !== params.data.projectId) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const storageKey = file?.storageKey ?? asset.storageKey;
    const mimeType = file?.mimeType ?? asset.mimeType;
    const kind = file?.kind ?? "ORIGINAL";
    const filePath = path.join(uploadDir(), storageKey);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File is missing on the server" });
      return;
    }

    // Audit the download.
    await db.insert(tandemVideoDownloadsTable).values({
      id: randomUUID(),
      projectId: project.id,
      fileId: params.data.fileId,
      fileName: `${asset.fileName.replace(/\.\w+$/, "")}-${kind.toLowerCase()}.${mimeType.includes("jpeg") ? "jpg" : "mp4"}`,
      memberId: userId,
    });
    logger.info({ projectId: project.id, fileId: params.data.fileId, memberId: userId }, "File downloaded");

    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    const downloadName = path.basename(storageKey);
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.sendFile(filePath);
  },
);

// GET /video/projects/:projectId/downloads — the audit trail (Captain only).
router.get(
  "/video/projects/:projectId/downloads",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoDownloadsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    const [project] = await db
      .select()
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.id, params.data.projectId))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.ownerId !== userId) {
      res.status(403).json({ error: "Only the Captain can view the download audit trail" });
      return;
    }

    const downloads = await db
      .select()
      .from(tandemVideoDownloadsTable)
      .where(eq(tandemVideoDownloadsTable.projectId, params.data.projectId))
      .orderBy(desc(tandemVideoDownloadsTable.createdAt));

    res.json(ListVideoDownloadsResponse.parse(downloads));
  },
);

export default router;
