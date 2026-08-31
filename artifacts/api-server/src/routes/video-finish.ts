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
  tandemVideoSyncsTable,
  type TandemVideoAsset,
  type TandemVideoMember,
} from "@workspace/db";
import { gt, isNull } from "drizzle-orm";
import {
  DownloadVideoFileParams,
  DownloadVideoFinishMasterParams,
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
import { and, desc, eq, or } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getFFmpegPath, uploadDir } from "../video/worker";
import { getStore, r2Configured } from "../video/object-storage";
import { logger } from "../lib/logger";
import { emitJobProgress } from "../realtime";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// M3 — the finish line. Sound Designer and Motion & Color actions plus the
// Lock release: once the Captain approves the FINISH leg, the project flips
// to RELEASED and files become downloadable (every download is audited).
// ---------------------------------------------------------------------------

// Each leg's studio is owned by one of the four content roles. FINISH actions
// (exports, thumbnail queue, lock approval) are Captain-only.
const LEG_ROLES: Record<string, string> = {
  SELECTS: "VIDEO",
  CUT: "VIDEO",
  SOUND: "AUDIO",
  FINISH: "CAPTAIN",
  THUMBNAIL: "THUMBNAIL",
} as const;

// The vault kind a file belongs to maps to the role that owns it — used to
// decide which role grants unlock a download.
const ROLE_KINDS: Record<string, string[]> = {
  VIDEO: ["RAW_VIDEO", "SCREEN_REC", "B_ROLL", "REFERENCE"],
  AUDIO: ["RAW_AUDIO", "VO_PICKUP"],
  THUMBNAIL: ["THUMBNAIL_DESIGN", "GRAPHIC"],
  // Scripts live in the browser (the script desk), not the vault — the SCRIPT
  // role owns no physical files today, so its grants unlock nothing until
  // script files exist.
  SCRIPT: [],
};

/** The owning role of a vault asset kind, or null when no role owns it. */
function roleForKind(kind: string): string | null {
  for (const [role, kinds] of Object.entries(ROLE_KINDS)) {
    if (kinds.includes(kind)) return role;
  }
  return null;
}

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
  if ((member.roles ?? []).includes("CAPTAIN")) return member;
  return (member.roles ?? []).includes(LEG_ROLES[leg]) ? member : null;
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

    // Resolve the file first: the Lock/grant check needs the asset kind to
    // know which role's files this download belongs to.
    const [file] = await db
      .select()
      .from(tandemVideoAssetFilesTable)
      .where(eq(tandemVideoAssetFilesTable.id, params.data.fileId))
      .limit(1);

    let asset;
    if (file && file.assetId) {
      [asset] = await db
        .select()
        .from(tandemVideoAssetsTable)
        .where(eq(tandemVideoAssetsTable.id, file.assetId))
        .limit(1);
    } else if (file) {
      // Project-scoped artifact (e.g. an INTERCHANGE bundle) — not an asset
      // download, so reject rather than fall through to an asset lookup.
      res.status(404).json({ error: "File not found" });
      return;
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

    if (project.status !== "RELEASED") {
      // M4: a temporary grant from the Captain bypasses the Lock while active.
      // Grants are role-scoped: they unlock every file version under the
      // granted roles (["ALL"] covers every file in the project).
      const fileRole = roleForKind(asset.kind);
      const grants = await db
        .select()
        .from(tandemVideoGrantsTable)
        .where(
          and(
            eq(tandemVideoGrantsTable.projectId, project.id),
            eq(tandemVideoGrantsTable.memberId, userId),
            isNull(tandemVideoGrantsTable.revokedAt),
            gt(tandemVideoGrantsTable.expiresAt, new Date()),
          ),
        );
      const allowed = grants.some((grant) => {
        const grantRoles = grant.roles ?? [];
        return grantRoles.includes("ALL") ||
          (fileRole !== null && grantRoles.includes(fileRole));
      });
      if (!allowed) {
        res.status(403).json({
          error: "The Lock is still on — downloads open once the Captain approves the final master",
        });
        return;
      }
    }

    const storageKey = file?.storageKey ?? asset.storageKey;
    const mimeType = file?.mimeType ?? asset.mimeType;
    const kind = file?.kind ?? "ORIGINAL";

    // Audit the download — always write the trail, regardless of storage
    // backend, so the Lock/release paper trail stays complete.
    await db.insert(tandemVideoDownloadsTable).values({
      id: randomUUID(),
      projectId: project.id,
      fileId: params.data.fileId,
      fileName: `${asset.fileName.replace(/\.\w+$/, "")}-${kind.toLowerCase()}.${mimeType.includes("jpeg") ? "jpg" : "mp4"}`,
      memberId: userId,
    });
    logger.info({ projectId: project.id, fileId: params.data.fileId, memberId: userId }, "File downloaded");

    // The file lives in R2 → redirect to a short-lived presigned GET. The
    // browser pulls bytes straight from Cloudflare; we only hand back a URL.
    const provider = file?.storageProvider ?? (r2Configured() ? "r2" : "local");
    if (provider === "r2") {
      const url = await getStore().getUrl(project.id, storageKey);
      if (url) {
        res.redirect(302, url);
        return;
      }
    }

    const filePath = path.join(uploadDir(), storageKey);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File is missing on the server" });
      return;
    }

    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    const downloadName = path.basename(storageKey);
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.sendFile(filePath);
  },
);

// The vault kinds that make up a FINISH master: video (the picture) and
// audio (the separate sound track, e.g. dual-system sound or the VO pickup).
const VIDEO_KINDS = ["RAW_VIDEO", "SCREEN_REC", "B_ROLL", "REFERENCE"];
const AUDIO_KINDS = ["RAW_AUDIO", "VO_PICKUP"];

/** The newest asset of the project (by upload time) matching one of the kinds. */
async function latestAssetOfKind(
  projectId: string,
  kinds: string[],
): Promise<TandemVideoAsset | null> {
  const [asset] = await db
    .select()
    .from(tandemVideoAssetsTable)
    .where(
      and(
        eq(tandemVideoAssetsTable.projectId, projectId),
        or(...kinds.map((k) => eq(tandemVideoAssetsTable.kind, k))),
      ),
    )
    .orderBy(desc(tandemVideoAssetsTable.createdAt))
    .limit(1);
  return asset ?? null;
}

/** True when the member is unlocked for every role this master touches. */
async function memberCanDownloadMaster(
  project: { id: string; status: string },
  member: TandemVideoMember,
  roles: string[],
): Promise<boolean> {
  if (project.status === "RELEASED") return true;
  if (roles.length === 0) return true;
  const grants = await db
    .select()
    .from(tandemVideoGrantsTable)
    .where(
      and(
        eq(tandemVideoGrantsTable.projectId, project.id),
        eq(tandemVideoGrantsTable.memberId, member.userId),
        isNull(tandemVideoGrantsTable.revokedAt),
        gt(tandemVideoGrantsTable.expiresAt, new Date()),
      ),
    );
  if (grants.length === 0) return false;
  return roles.every((role) =>
    grants.some((grant) => {
      const grantRoles = grant.roles ?? [];
      return grantRoles.includes("ALL") || grantRoles.includes(role);
    }),
  );
}

/**
 * Builds a single synced "master" media file: the latest video with the latest
 * audio muxed in as its soundtrack. Any waveform-synced offset recorded for the
 * pair (video ↔ audio) is honored so the sound lines up with the picture.
 *
 * Returns the on-disk path of the finished file plus the name to hand the user.
 * When ffmpeg is unavailable (demo mode) and the video already carries its own
 * audio track, the video file is returned unchanged so a real master still
 * comes through.
 */
async function buildFinishMaster(
  projectId: string,
): Promise<{
  filePath: string;
  fileName: string;
  audioOnly: boolean;
} | null> {
  const video = await latestAssetOfKind(projectId, VIDEO_KINDS);
  const audio = await latestAssetOfKind(projectId, AUDIO_KINDS);

  // Nothing to export at all (or only media with no downloadable bytes).
  if (video && audio) {
    const videoPath = path.join(uploadDir(), video.storageKey);
    const audioPath = path.join(uploadDir(), audio.storageKey);
    if (!fs.existsSync(videoPath) || !fs.existsSync(audioPath)) return null;

    const ffmpeg = getFFmpegPath();
    if (!ffmpeg) {
      // Demo mode: we can't mux without ffmpeg, so hand back the latest video
      // alone (it usually carries in-camera audio); the recipient can pair the
      // separate audio file from the vault directly.
      return {
        filePath: videoPath,
        fileName: `${video.fileName.replace(/\.[^.]+$/, "")}-master.mp4`,
        audioOnly: false,
      };
    }

    // A recorded sync offset (M2) tells us how far the audio leads the video;
    // we push the sound track later by that amount so they align. The stored
    // offset is "target leads primary" (positive ⇒ target leads), so we derive
    // "audio leads video" from whether the audio is the sync's target.
    const [sync] = await db
      .select()
      .from(tandemVideoSyncsTable)
      .where(
        and(
          eq(tandemVideoSyncsTable.projectId, projectId),
          or(
            and(
              eq(tandemVideoSyncsTable.primaryAssetId, video.id),
              eq(tandemVideoSyncsTable.targetAssetId, audio.id),
            ),
            and(
              eq(tandemVideoSyncsTable.primaryAssetId, audio.id),
              eq(tandemVideoSyncsTable.targetAssetId, video.id),
            ),
          ),
        ),
      )
      .limit(1);
    const audioLeadsMs =
      sync == null ? 0 : sync.targetAssetId === audio.id ? sync.offsetMs : -sync.offsetMs;

    const outDir = path.join(uploadDir(), "finish");
    fs.mkdirSync(outDir, { recursive: true });
    const outKey = `finish/${projectId}-master-${Date.now()}.mp4`;
    const outPath = path.join(uploadDir(), outKey);
    const audioDelaySec = Math.max(0, audioLeadsMs / 1000);

    const args: string[] = ["-y"];
    if (audioDelaySec > 0) {
      args.push("-itsoffset", audioDelaySec.toFixed(3));
    }
    args.push("-i", audioPath, "-i", videoPath);

    // Video: copy the compressed frames untouched. Audio: transcode to AAC so
    // the track is universally playable in an MP4 container. faststart marks
    // the moov box up front so the result streams in any browser.
    const encode = spawnSync(
      ffmpeg,
      [
        ...args,
        "-map",
        "1:v:0",
        "-map",
        "0:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        outPath,
      ],
      { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 60 * 60 * 1000 },
    );
    // If the picture carries no separable audio stream ffmpeg may refuse to
    // copy — fall back to re-encoding the audio rather than failing the export.
    let finalPath = outPath;
    if (encode.status !== 0) {
      const retry = spawnSync(
        ffmpeg,
        [
          ...args,
          "-map",
          "1:v:0",
          "-map",
          "0:a:0",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          // Pad the (shorter) sound track so the master keeps full length.
          "-af",
          "apad",
          "-shortest",
          "-movflags",
          "+faststart",
          outPath,
        ],
        { encoding: "utf8", stdio: ["ignore", "ignore", "pipe"], timeout: 60 * 60 * 1000 },
      );
      if (retry.status !== 0) {
        const stderr = String(retry.stderr ?? "").trim();
        logger.warn(
          { projectId, stderr: stderr.slice(-800) },
          "Finish master mux failed; falling back to the raw video file",
        );
        finalPath = videoPath;
      }
    }
    const name = `${video.fileName.replace(/\.[^.]+$/, "")}-with-${audio.fileName.replace(/\.[^.]+$/, "")}.mp4`;
    return { filePath: finalPath, fileName: name, audioOnly: false };
  }

  if (video) {
    const videoPath = path.join(uploadDir(), video.storageKey);
    if (!fs.existsSync(videoPath)) return null;
    return {
      filePath: videoPath,
      fileName: video.fileName,
      audioOnly: false,
    };
  }

  if (audio) {
    const audioPath = path.join(uploadDir(), audio.storageKey);
    if (!fs.existsSync(audioPath)) return null;
    return {
      filePath: audioPath,
      fileName: audio.fileName,
      audioOnly: true,
    };
  }

  return null;
}

// GET /video/projects/:projectId/finish/master — the synced video+audio master.
// Instead of handing out the latest video and latest audio as two separate
// downloads, the finish desk delivers ONE file: the picture with the separate
// sound muxed in, waveform-synced. Same Lock/grant gate and audit trail as any
// raw file download.
router.get(
  "/video/projects/:projectId/finish/master",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = DownloadVideoFinishMasterParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
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

    const master = await buildFinishMaster(project.id);
    if (!master) {
      res.status(400).json({ error: "Nothing to export yet — the vault has no processed media." });
      return;
    }

    // Unlock requires suitable grants for the roles this master touches.
    const roles =
      (await latestAssetOfKind(project.id, VIDEO_KINDS)) &&
      (await latestAssetOfKind(project.id, AUDIO_KINDS))
        ? ["VIDEO", "AUDIO"]
        : master.audioOnly
          ? ["AUDIO"]
          : ["VIDEO"];
    if (!(await memberCanDownloadMaster(project, member, roles))) {
      res.status(403).json({
        error: "The Lock is still on — downloads open once the Captain approves the final master",
      });
      return;
    }

    // Audit the download so the Captain can see who took the finished master.
    await db.insert(tandemVideoDownloadsTable).values({
      id: randomUUID(),
      projectId: project.id,
      fileId: `finish-master-${project.id}`,
      fileName: master.fileName,
      memberId: userId,
    });
    logger.info({ projectId: project.id, memberId: userId }, "Finish master downloaded");

    res.setHeader("Content-Type", master.audioOnly ? "audio/mpeg" : "video/mp4");
    const downloadName = path.basename(master.fileName);
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.sendFile(master.filePath);
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
