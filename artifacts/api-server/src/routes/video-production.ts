import { getAuth } from "@clerk/express";
import { logger } from "../lib/logger";
import { emitToProject } from "../realtime";
import { notify } from "./video-platform";
import {
  db,
  tandemVideoAssetFilesTable,
  tandemVideoAssetsTable,
  tandemVideoCommentsTable,
  tandemVideoMembersTable,
  tandemVideoProjectsTable,
  tandemVideoSubmissionsTable,
  tandemVideoSyncsTable,
  tandemVideoTimelinesTable,
  tandemVideoTimelineVersionsTable,
  tandemVideoTranscriptSegmentsTable,
  tandemVideoTranscriptsTable,
  tandemVideoJobsTable,
  type TandemVideoMember,
} from "@workspace/db";
import {
  ApproveVideoSubmissionParams,
  ApproveVideoSubmissionResponse,
  CreateVideoCommentBody,
  CreateVideoCommentParams,
  CreateVideoCommentResponse,
  CreateVideoSubmissionBody,
  CreateVideoSubmissionParams,
  CreateVideoSubmissionResponse,
  GetVideoAssetParams,
  GetVideoAssetResponse,
  ExportVideoTimelineCheckoutBody,
  ExportVideoTimelineCheckoutResponse,
  GetVideoTimelineCheckoutBundleResponse,
  GetVideoTimelineParams,
  GetVideoTimelineResponse,
  GetVideoTimelineVersionParams,
  GetVideoTimelineVersionResponse,
  ListVideoCommentsParams,
  ListVideoCommentsResponse,
  ListVideoJobsParams,
  ListVideoJobsResponse,
  ListVideoSubmissionsParams,
  ListVideoSubmissionsResponse,
  ListVideoSyncsParams,
  ListVideoSyncsResponse,
  ListVideoTimelineVersionsParams,
  ListVideoTimelineVersionsResponse,
  RejectVideoSubmissionParams,
  RejectVideoSubmissionResponse,
  RenderVideoTimelineBody,
  RenderVideoTimelineParams,
  RenderVideoTimelineResponse,
  ResolveVideoCommentBody,
  ResolveVideoCommentParams,
  ResolveVideoCommentResponse,
  RollbackVideoTimelineBody,
  RollbackVideoTimelineParams,
  RollbackVideoTimelineResponse,
  SaveVideoTimelineBody,
  SaveVideoTimelineParams,
  SaveVideoTimelineResponse,
  SyncVideoAssetBody,
  SyncVideoAssetParams,
  SyncVideoAssetResponse,
} from "@workspace/api-zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  enqueueExportBundleJob,
  enqueueRenderJob,
  enqueueSyncJob,
  hasActiveExportBundle,
  hasActiveRender,
  requeueProxyJob,
  uploadDir,
} from "../video/worker";
import {
  parseTimelineEdl,
  resolveEdlEvents,
  type EdlClip,
  type ParsedEdlEvent,
} from "../video/edl";
import {
  parseTimelineFcpxml,
  resolveFcpxmlEvents,
  type ParsedFcpxmlClip,
} from "../video/fcpxml";
import {
  parseTimelineOtio,
  resolveOtioEvents,
  type ParsedOtioClip,
} from "../video/otio";
import { buildCheckout } from "../video/checkout";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// M1 — the Story Architect milestone. Routes for the processed vault (asset
// detail + proxy streaming), the per-leg Git-style timelines, submissions,
// timecode comments, and the processing job queue. All member-gated; leg
// writes require the matching leg role (or the Captain).
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

async function buildTimelineResponse(projectId: string, leg: string) {
  const [timeline] = await db
    .select()
    .from(tandemVideoTimelinesTable)
    .where(
      and(
        eq(tandemVideoTimelinesTable.projectId, projectId),
        eq(tandemVideoTimelinesTable.leg, leg),
      ),
    )
    .limit(1);

  if (!timeline) {
    return {
      id: "",
      projectId,
      leg,
      status: "DRAFT",
      version: null,
      snapshot: null,
      versions: [],
      updatedAt: new Date(),
    };
  }

  const versions = await db
    .select()
    .from(tandemVideoTimelineVersionsTable)
    .where(eq(tandemVideoTimelineVersionsTable.timelineId, timeline.id))
    .orderBy(desc(tandemVideoTimelineVersionsTable.version));

  const current = timeline.currentVersionId
    ? versions.find((version) => version.id === timeline.currentVersionId)
    : null;

  return {
    id: timeline.id,
    projectId: timeline.projectId,
    leg: timeline.leg,
    status: timeline.status,
    version: current?.version ?? null,
    snapshot: current?.snapshot ?? null,
    versions: versions.map((version) => ({
      id: version.id,
      version: version.version,
      message: version.message,
      createdById: version.createdById,
      createdAt: version.createdAt,
    })),
    updatedAt: timeline.updatedAt,
  };
}

// GET /video/projects/:projectId/assets/:assetId — processed asset detail
// (files + transcript). Members only.
router.get(
  "/video/projects/:projectId/assets/:assetId",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoAssetParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid asset id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [asset] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.id, params.data.assetId))
      .limit(1);
    if (!asset || asset.projectId !== params.data.projectId) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const files = await db
      .select()
      .from(tandemVideoAssetFilesTable)
      .where(eq(tandemVideoAssetFilesTable.assetId, asset.id))
      .orderBy(asc(tandemVideoAssetFilesTable.createdAt));

    const [transcript] = await db
      .select()
      .from(tandemVideoTranscriptsTable)
      .where(eq(tandemVideoTranscriptsTable.assetId, asset.id))
      .limit(1);

    let transcriptPayload = null;
    if (transcript) {
      const segments = await db
        .select()
        .from(tandemVideoTranscriptSegmentsTable)
        .where(eq(tandemVideoTranscriptSegmentsTable.transcriptId, transcript.id))
        .orderBy(asc(tandemVideoTranscriptSegmentsTable.startMs));
      transcriptPayload = {
        id: transcript.id,
        assetId: transcript.assetId,
        language: transcript.language,
        model: transcript.model,
        status: transcript.status,
        segments: segments.map((segment) => ({
          id: segment.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text,
          speaker: segment.speaker,
        })),
      };
    }

    res.json(
      GetVideoAssetResponse.parse({
        ...asset,
        files: files.map((file) => ({
          id: file.id,
          kind: file.kind,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          metadata: file.metadata,
          createdAt: file.createdAt,
        })),
        transcript: transcriptPayload,
      }),
    );
  },
);

// GET /video/projects/:projectId/assets/:assetId/proxy — stream the low-res
// proxy. The Lock: only proxies leave the server, never originals.
router.get(
  "/video/projects/:projectId/assets/:assetId/proxy",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoAssetParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid asset id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [asset] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.id, params.data.assetId))
      .limit(1);
    if (!asset || asset.projectId !== params.data.projectId) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const [proxy] = await db
      .select()
      .from(tandemVideoAssetFilesTable)
      .where(
        and(
          eq(tandemVideoAssetFilesTable.assetId, asset.id),
          eq(tandemVideoAssetFilesTable.kind, "PROXY"),
        ),
      )
      .limit(1);

    if (!proxy) {
      res.status(404).json({ error: "No proxy is available for this asset yet" });
      return;
    }

    const filePath = path.join(uploadDir(), proxy.storageKey);
    if (!fs.existsSync(filePath)) {
      // The proxy record exists in the DB but the file is gone from disk
      // (common after a container restart on ephemeral storage). Clean up
      // the stale record, re-queue the proxy job, and let the frontend
      // polling loop pick up the regenerated file.
      await db.delete(tandemVideoAssetFilesTable).where(eq(tandemVideoAssetFilesTable.id, proxy.id));
      await requeueProxyJob(asset.projectId, asset.id);
      await db.update(tandemVideoAssetsTable).set({ status: "UPLOADED" }).where(eq(tandemVideoAssetsTable.id, asset.id));
      res.status(409).json({ error: "Proxy file is missing — regenerating" });
      return;
    }

    // Stream the file directly instead of using res.sendFile — Express 5's
    // send library can reject valid paths on some platforms.
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const mimeType = proxy.mimeType || "video/mp4";
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0] ?? "0", 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mimeType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath).pipe(res);
    }
  },
);

// GET /video/projects/:projectId/timelines/:leg — current working timeline.
router.get(
  "/video/projects/:projectId/timelines/:leg",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const state = await buildTimelineResponse(params.data.projectId, params.data.leg);
    res.json(GetVideoTimelineResponse.parse(state));
  },
);

// PUT /video/projects/:projectId/timelines/:leg — save a snapshot (creates a
// Git-style version). Requires the leg role or the Captain.
router.put(
  "/video/projects/:projectId/timelines/:leg",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    const body = SaveVideoTimelineBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid timeline save request" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, params.data.leg, userId);
    if (!member) {
      res.status(403).json({ error: "Only the leg role (or the Captain) can edit this timeline" });
      return;
    }

    const [timeline] = await db
      .select()
      .from(tandemVideoTimelinesTable)
      .where(
        and(
          eq(tandemVideoTimelinesTable.projectId, params.data.projectId),
          eq(tandemVideoTimelinesTable.leg, params.data.leg),
        ),
      )
      .limit(1);

    let timelineId = timeline?.id ?? "";
    if (!timeline) {
      const [created] = await db
        .insert(tandemVideoTimelinesTable)
        .values({
          id: randomUUID(),
          projectId: params.data.projectId,
          leg: params.data.leg,
          status: "DRAFT",
        })
        .returning();
      timelineId = created.id;
    }

    const [latest] = await db
      .select()
      .from(tandemVideoTimelineVersionsTable)
      .where(eq(tandemVideoTimelineVersionsTable.timelineId, timelineId))
      .orderBy(desc(tandemVideoTimelineVersionsTable.version))
      .limit(1);

    const versionNumber = (latest?.version ?? 0) + 1;
    const [version] = await db
      .insert(tandemVideoTimelineVersionsTable)
      .values({
        id: randomUUID(),
        timelineId,
        version: versionNumber,
        snapshot: body.data.snapshot,
        message: body.data.message ?? "",
        createdById: userId,
        parentVersionId: latest?.id ?? null,
      })
      .returning();

    await db
      .update(tandemVideoTimelinesTable)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(tandemVideoTimelinesTable.id, timelineId));

    // Realtime: teammates in the studio see the new snapshot appear live.
    emitToProject(params.data.projectId, "timeline.saved", {
      projectId: params.data.projectId,
      leg: params.data.leg,
      version: version.version,
      versionId: version.id,
      message: version.message,
      createdById: userId,
    });

    const state = await buildTimelineResponse(params.data.projectId, params.data.leg);
    res.json(SaveVideoTimelineResponse.parse(state));
  },
);

// GET /video/projects/:projectId/timelines/:leg/versions — snapshot history.
router.get(
  "/video/projects/:projectId/timelines/:leg/versions",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoTimelineVersionsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [timeline] = await db
      .select()
      .from(tandemVideoTimelinesTable)
      .where(
        and(
          eq(tandemVideoTimelinesTable.projectId, params.data.projectId),
          eq(tandemVideoTimelinesTable.leg, params.data.leg),
        ),
      )
      .limit(1);

    if (!timeline) {
      res.json(ListVideoTimelineVersionsResponse.parse([]));
      return;
    }

    const versions = await db
      .select()
      .from(tandemVideoTimelineVersionsTable)
      .where(eq(tandemVideoTimelineVersionsTable.timelineId, timeline.id))
      .orderBy(desc(tandemVideoTimelineVersionsTable.version));

    res.json(
      ListVideoTimelineVersionsResponse.parse(
        versions.map((version) => ({
          id: version.id,
          version: version.version,
          message: version.message,
          createdById: version.createdById,
          createdAt: version.createdAt,
        })),
      ),
    );
  },
);

// GET /video/projects/:projectId/timelines/:leg/versions/:versionId — the full
// snapshot of one version, so reviewers can diff two snapshots side-by-side
// (the list endpoint returns summaries only).
router.get(
  "/video/projects/:projectId/timelines/:leg/versions/:versionId",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineVersionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid version id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [timeline] = await db
      .select()
      .from(tandemVideoTimelinesTable)
      .where(
        and(
          eq(tandemVideoTimelinesTable.projectId, params.data.projectId),
          eq(tandemVideoTimelinesTable.leg, params.data.leg),
        ),
      )
      .limit(1);
    if (!timeline) {
      res.status(404).json({ error: "This leg has no timeline yet" });
      return;
    }

    const [version] = await db
      .select()
      .from(tandemVideoTimelineVersionsTable)
      .where(eq(tandemVideoTimelineVersionsTable.id, params.data.versionId))
      .limit(1);
    if (!version || version.timelineId !== timeline.id) {
      res.status(404).json({ error: "Timeline version not found" });
      return;
    }

    res.json(
      GetVideoTimelineVersionResponse.parse({
        id: version.id,
        version: version.version,
        message: version.message,
        createdById: version.createdById,
        parentVersionId: version.parentVersionId,
        createdAt: version.createdAt,
        snapshot: version.snapshot,
      }),
    );
  },
);

// POST /video/projects/:projectId/timelines/:leg/rollback — restore a previous
// snapshot as the new head (new version, history preserved).
router.post(
  "/video/projects/:projectId/timelines/:leg/rollback",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = RollbackVideoTimelineParams.safeParse(req.params);
    const body = RollbackVideoTimelineBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid rollback request" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, params.data.leg, userId);
    if (!member) {
      res.status(403).json({ error: "Only the leg role (or the Captain) can edit this timeline" });
      return;
    }

    const [timeline] = await db
      .select()
      .from(tandemVideoTimelinesTable)
      .where(
        and(
          eq(tandemVideoTimelinesTable.projectId, params.data.projectId),
          eq(tandemVideoTimelinesTable.leg, params.data.leg),
        ),
      )
      .limit(1);
    if (!timeline) {
      res.status(400).json({ error: "This leg has no timeline yet" });
      return;
    }

    const [target] = await db
      .select()
      .from(tandemVideoTimelineVersionsTable)
      .where(eq(tandemVideoTimelineVersionsTable.id, body.data.versionId))
      .limit(1);
    if (!target || target.timelineId !== timeline.id) {
      res.status(400).json({ error: "Unknown timeline version" });
      return;
    }

    const [latest] = await db
      .select()
      .from(tandemVideoTimelineVersionsTable)
      .where(eq(tandemVideoTimelineVersionsTable.timelineId, timeline.id))
      .orderBy(desc(tandemVideoTimelineVersionsTable.version))
      .limit(1);

    const [restored] = await db
      .insert(tandemVideoTimelineVersionsTable)
      .values({
        id: randomUUID(),
        timelineId: timeline.id,
        version: (latest?.version ?? 0) + 1,
        snapshot: target.snapshot,
        message: `Rollback to v${target.version}`,
        createdById: userId,
        parentVersionId: latest?.id ?? null,
      })
      .returning();

    await db
      .update(tandemVideoTimelinesTable)
      .set({ currentVersionId: restored.id, updatedAt: new Date() })
      .where(eq(tandemVideoTimelinesTable.id, timeline.id));

    emitToProject(params.data.projectId, "timeline.saved", {
      projectId: params.data.projectId,
      leg: params.data.leg,
      version: restored.version,
      versionId: restored.id,
      message: restored.message,
      createdById: userId,
    });

    const state = await buildTimelineResponse(params.data.projectId, params.data.leg);
    res.json(RollbackVideoTimelineResponse.parse(state));
  },
);

// GET /video/projects/:projectId/submissions — leg submissions for the project.
router.get(
  "/video/projects/:projectId/submissions",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoSubmissionsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const submissions = await db
      .select()
      .from(tandemVideoSubmissionsTable)
      .where(eq(tandemVideoSubmissionsTable.projectId, params.data.projectId))
      .orderBy(desc(tandemVideoSubmissionsTable.createdAt));

    res.json(ListVideoSubmissionsResponse.parse(submissions));
  },
);

// POST /video/projects/:projectId/submissions — submit the leg's current
// snapshot for Captain review. Requires the leg role or the Captain.
router.post(
  "/video/projects/:projectId/submissions",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = CreateVideoSubmissionParams.safeParse(req.params);
    const body = CreateVideoSubmissionBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid submission request" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, body.data.leg, userId);
    if (!member) {
      res.status(403).json({ error: "Only the leg role (or the Captain) can submit this leg" });
      return;
    }

    const [timeline] = await db
      .select()
      .from(tandemVideoTimelinesTable)
      .where(
        and(
          eq(tandemVideoTimelinesTable.projectId, params.data.projectId),
          eq(tandemVideoTimelinesTable.leg, body.data.leg),
        ),
      )
      .limit(1);
    if (!timeline || !timeline.currentVersionId) {
      res.status(400).json({ error: "This leg has no saved snapshot to submit" });
      return;
    }

    const [pending] = await db
      .select()
      .from(tandemVideoSubmissionsTable)
      .where(
        and(
          eq(tandemVideoSubmissionsTable.projectId, params.data.projectId),
          eq(tandemVideoSubmissionsTable.leg, body.data.leg),
          eq(tandemVideoSubmissionsTable.status, "SUBMITTED"),
        ),
      )
      .limit(1);
    if (pending) {
      res.status(409).json({ error: "A submission for this leg is already pending review" });
      return;
    }

    const [submission] = await db
      .insert(tandemVideoSubmissionsTable)
      .values({
        id: randomUUID(),
        projectId: params.data.projectId,
        leg: body.data.leg,
        timelineVersionId: timeline.currentVersionId,
        status: "SUBMITTED",
        note: body.data.note ?? "",
        submittedById: userId,
      })
      .returning();

    await db
      .update(tandemVideoTimelinesTable)
      .set({ status: "SUBMITTED", updatedAt: new Date() })
      .where(eq(tandemVideoTimelinesTable.id, timeline.id));

    // Realtime: the vault's relay panel and the Captain's studio flip to
    // "pending review" the moment the leg is handed over.
    emitToProject(params.data.projectId, "submission.new", submission);

    // Notify the Captain a leg is ready for review (M4).
    const [owner] = await db
      .select()
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.id, params.data.projectId))
      .limit(1);
    if (owner && owner.ownerId !== userId) {
      await notify(
        owner.ownerId,
        "video_submission",
        `Leg ${body.data.leg} submitted for review`,
        `The ${body.data.leg} leg was submitted${body.data.note ? ` — “${body.data.note.slice(0, 120)}”` : ""}.`,
        `/creators-den/projects/${params.data.projectId}`,
        submission.id,
      ).catch(() => {});
    }

    // Picture-lock render on submit (M2): the Visual Editor's submission kicks
    // off a render of the head snapshot so the Captain reviews the cut, not
    // just the JSON.
    if (body.data.leg === "CUT") {
      const [head] = await db
        .select()
        .from(tandemVideoTimelineVersionsTable)
        .where(eq(tandemVideoTimelineVersionsTable.id, timeline.currentVersionId))
        .limit(1);
      const headSnapshot = (head?.snapshot ?? {}) as { clips?: Array<{ assetId?: string }> };
      const headAssetId = headSnapshot.clips?.[0]?.assetId;
      if (headAssetId) {
        await enqueueRenderJob(
          params.data.projectId,
          body.data.leg,
          "PICTURE_LOCK",
          headAssetId,
          timeline.currentVersionId,
        ).catch(() => {});
      }
    }

    res.status(201).json(CreateVideoSubmissionResponse.parse(submission));
  },
);

async function decideSubmission(
  req: Request,
  res: Response,
  decision: "APPROVED" | "REJECTED",
  parseResponse: (data: unknown) => unknown,
): Promise<void> {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = ApproveVideoSubmissionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid submission id" });
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
    res.status(403).json({ error: "Only the Captain can approve or reject submissions" });
    return;
  }

  const [submission] = await db
    .select()
    .from(tandemVideoSubmissionsTable)
    .where(eq(tandemVideoSubmissionsTable.id, params.data.submissionId))
    .limit(1);
  if (!submission || submission.projectId !== params.data.projectId) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  if (submission.status !== "SUBMITTED") {
    res.status(409).json({ error: "This submission is not pending review" });
    return;
  }

  const [updated] = await db
    .update(tandemVideoSubmissionsTable)
    .set({ status: decision, decidedById: userId, decidedAt: new Date(), updatedAt: new Date() })
    .where(eq(tandemVideoSubmissionsTable.id, submission.id))
    .returning();

  await db
    .update(tandemVideoTimelinesTable)
    .set({ status: decision, updatedAt: new Date() })
    .where(
      and(
        eq(tandemVideoTimelinesTable.projectId, submission.projectId),
        eq(tandemVideoTimelinesTable.leg, submission.leg),
      ),
    );

  // Realtime: the submitter's studio learns the decision instantly.
  emitToProject(submission.projectId, "submission.decided", updated);

  // Lock release (M3): approving the FINISH leg flips the project to RELEASED,
  // enabling downloads for the whole team.
  if (submission.leg === "FINISH" && decision === "APPROVED") {
    await db
      .update(tandemVideoProjectsTable)
      .set({ status: "RELEASED", updatedAt: new Date() })
      .where(eq(tandemVideoProjectsTable.id, submission.projectId));
    logger.info({ projectId: submission.projectId }, "The Lock is released — finals downloadable");

    // Tell every member the lock is off (M4).
    const members = await db
      .select()
      .from(tandemVideoMembersTable)
      .where(eq(tandemVideoMembersTable.projectId, submission.projectId));
    for (const member of members) {
      await notify(
        member.userId,
        "video_released",
        "The Lock is released",
        "The Captain approved the final master — downloads are open.",
        `/creators-den/projects/${submission.projectId}`,
        submission.id,
      ).catch(() => {});
    }
  }

  // Tell the submitter their leg was decided (M4).
  if (submission.submittedById !== userId) {
    await notify(
      submission.submittedById,
      decision === "APPROVED" ? "video_approved" : "video_rejected",
      decision === "APPROVED" ? `Leg ${submission.leg} approved` : `Leg ${submission.leg} needs another pass`,
      decision === "APPROVED"
        ? "The Captain approved your submission — on to the next leg."
        : "The Captain sent your submission back — revise and resubmit.",
      `/creators-den/projects/${submission.projectId}`,
      submission.id,
    ).catch(() => {});
  }

  res.json(parseResponse(updated));
}

// POST .../submissions/:submissionId/approve — Captain approves.
router.post(
  "/video/projects/:projectId/submissions/:submissionId/approve",
  (req, res) => decideSubmission(req, res, "APPROVED", (data) => ApproveVideoSubmissionResponse.parse(data)),
);

// POST .../submissions/:submissionId/reject — Captain rejects.
router.post(
  "/video/projects/:projectId/submissions/:submissionId/reject",
  (req, res) => decideSubmission(req, res, "REJECTED", (data) => RejectVideoSubmissionResponse.parse(data)),
);

// GET /video/projects/:projectId/comments — timecode comments.
router.get(
  "/video/projects/:projectId/comments",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoCommentsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const comments = await db
      .select()
      .from(tandemVideoCommentsTable)
      .where(eq(tandemVideoCommentsTable.projectId, params.data.projectId))
      .orderBy(desc(tandemVideoCommentsTable.createdAt));

    res.json(ListVideoCommentsResponse.parse(comments));
  },
);

// POST /video/projects/:projectId/comments — add a timecode comment.
router.post(
  "/video/projects/:projectId/comments",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = CreateVideoCommentParams.safeParse(req.params);
    const body = CreateVideoCommentBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid comment" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    if (body.data.assetId) {
      const [asset] = await db
        .select()
        .from(tandemVideoAssetsTable)
        .where(eq(tandemVideoAssetsTable.id, body.data.assetId))
        .limit(1);
      if (!asset || asset.projectId !== params.data.projectId) {
        res.status(400).json({ error: "Unknown asset for this project" });
        return;
      }
    }

    const [comment] = await db
      .insert(tandemVideoCommentsTable)
      .values({
        id: randomUUID(),
        projectId: params.data.projectId,
        leg: body.data.leg ?? null,
        assetId: body.data.assetId ?? null,
        timecodeMs: body.data.timecodeMs ?? null,
        body: body.data.body,
        authorId: userId,
        parentId: body.data.parentId ?? null,
        // Unified annotation model: spatial pins/highlights + reviewer identity
        // + optional review (submission) / version scoping.
        geometry: body.data.geometry ?? null,
        kind: body.data.kind ?? "TIMECODE",
        color: body.data.color ?? null,
        label: body.data.label ?? null,
        submissionId: body.data.submissionId ?? null,
        timelineVersionId: body.data.timelineVersionId ?? null,
      })
      .returning();

    // Realtime: pinned notes appear in teammates' studios as they land.
    emitToProject(params.data.projectId, "comment.new", comment);

    res.status(201).json(CreateVideoCommentResponse.parse(comment));
  },
);

// PATCH /video/projects/:projectId/comments/:commentId — resolve/reopen.
router.patch(
  "/video/projects/:projectId/comments/:commentId",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ResolveVideoCommentParams.safeParse(req.params);
    const body = ResolveVideoCommentBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid comment update" });
      return;
    }

    const member = await requireMember(params.data.projectId, userId);
    if (!member) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [comment] = await db
      .select()
      .from(tandemVideoCommentsTable)
      .where(eq(tandemVideoCommentsTable.id, params.data.commentId))
      .limit(1);
    if (!comment || comment.projectId !== params.data.projectId) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }

    const isAuthor = comment.authorId === userId;
    const isCaptain = member.role === "CAPTAIN";
    if (!isAuthor && !isCaptain) {
      res.status(403).json({ error: "Only the author or the Captain can resolve this comment" });
      return;
    }

    const [updated] = await db
      .update(tandemVideoCommentsTable)
      .set({ resolvedAt: body.data.resolved ? new Date() : null })
      .where(eq(tandemVideoCommentsTable.id, comment.id))
      .returning();

    emitToProject(params.data.projectId, "comment.updated", updated);

    res.json(ResolveVideoCommentResponse.parse(updated));
  },
);

// GET /video/projects/:projectId/jobs — processing jobs for the project.
router.get(
  "/video/projects/:projectId/jobs",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoJobsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const jobs = await db
      .select()
      .from(tandemVideoJobsTable)
      .where(eq(tandemVideoJobsTable.projectId, params.data.projectId))
      .orderBy(desc(tandemVideoJobsTable.createdAt));

    res.json(ListVideoJobsResponse.parse(jobs));
  },
);

// POST /video/projects/:projectId/assets/:assetId/sync — multi-cam waveform
// sync (Visual Editor action). Requires the CUT leg role or the Captain.
router.post(
  "/video/projects/:projectId/assets/:assetId/sync",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = SyncVideoAssetParams.safeParse(req.params);
    const body = SyncVideoAssetBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid sync request" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, "CUT", userId);
    if (!member) {
      res.status(403).json({ error: "Only the Visual Editor (or the Captain) can sync cameras" });
      return;
    }

    const [primary] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.id, params.data.assetId))
      .limit(1);
    const [target] = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.id, body.data.targetAssetId))
      .limit(1);
    if (
      !primary ||
      primary.projectId !== params.data.projectId ||
      !target ||
      target.projectId !== params.data.projectId
    ) {
      res.status(400).json({ error: "Both assets must belong to this project" });
      return;
    }
    if (primary.id === target.id) {
      res.status(400).json({ error: "Cannot sync an asset with itself" });
      return;
    }

    const job = await enqueueSyncJob(params.data.projectId, primary.id, target.id);

    res.status(201).json(SyncVideoAssetResponse.parse(job));
  },
);

// GET /video/projects/:projectId/syncs — the multi-cam sync pairs (members).
router.get(
  "/video/projects/:projectId/syncs",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoSyncsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const syncs = await db
      .select()
      .from(tandemVideoSyncsTable)
      .where(eq(tandemVideoSyncsTable.projectId, params.data.projectId))
      .orderBy(desc(tandemVideoSyncsTable.updatedAt));

    res.json(ListVideoSyncsResponse.parse(syncs));
  },
);

// POST /video/projects/:projectId/timelines/:leg/render — queue a preview or
// picture-lock render. Leg role or Captain; one active render per leg.
router.post(
  "/video/projects/:projectId/timelines/:leg/render",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = RenderVideoTimelineParams.safeParse(req.params);
    const body = RenderVideoTimelineBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid render request" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, params.data.leg, userId);
    if (!member) {
      res.status(403).json({ error: "Only the leg role (or the Captain) can render" });
      return;
    }

    if (await hasActiveRender(params.data.projectId, params.data.leg)) {
      res.status(409).json({ error: "A render is already queued for this leg" });
      return;
    }

    const [timeline] = await db
      .select()
      .from(tandemVideoTimelinesTable)
      .where(
        and(
          eq(tandemVideoTimelinesTable.projectId, params.data.projectId),
          eq(tandemVideoTimelinesTable.leg, params.data.leg),
        ),
      )
      .limit(1);
    if (!timeline || !timeline.currentVersionId) {
      res.status(400).json({ error: "Save a snapshot before rendering" });
      return;
    }

    const [version] = await db
      .select()
      .from(tandemVideoTimelineVersionsTable)
      .where(eq(tandemVideoTimelineVersionsTable.id, timeline.currentVersionId))
      .limit(1);
    const snapshot = (version?.snapshot ?? {}) as { clips?: Array<{ assetId?: string }> };
    const clips = snapshot.clips ?? [];
    if (clips.length === 0) {
      res.status(400).json({ error: "Add clips to the timeline before rendering" });
      return;
    }
    const headAssetId = clips[0].assetId ?? timeline.projectId;

    await enqueueRenderJob(
      params.data.projectId,
      params.data.leg,
      body.data.format,
      headAssetId,
      timeline.currentVersionId,
    );
    const [job] = await db
      .select()
      .from(tandemVideoJobsTable)
      .where(
        and(
          eq(tandemVideoJobsTable.projectId, params.data.projectId),
          eq(tandemVideoJobsTable.type, "RENDER"),
          eq(tandemVideoJobsTable.assetId, headAssetId),
        ),
      )
      .orderBy(desc(tandemVideoJobsTable.createdAt))
      .limit(1);

    res.status(201).json(RenderVideoTimelineResponse.parse(job));
  },
);

// ---------------------------------------------------------------------------
// Checkout bridge (external-first) — export the leg's current snapshot as a
// CMX3600 EDL + a media manifest so the editor can finish the cut in an
// external NLE and re-import it later. Read-only; any member may check out.
// The document builder lives in ../video/checkout (shared with the
// EXPORT_BUNDLE worker processor).
// ---------------------------------------------------------------------------

function checkoutFilename(
  projectName: string,
  leg: string,
  version: number | null,
  format: "EDL" | "FCPXML" | "OTIO" | "AAF" = "EDL",
): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
  const ext =
    format === "FCPXML" ? "fcpxml" : format === "OTIO" ? "otio" : format === "AAF" ? "aaf" : "edl";
  return `${slug}-${leg.toLowerCase()}-v${version ?? 0}.${ext}`;
}

// GET /video/projects/:projectId/timelines/:leg/checkout — the EDL file.
router.get(
  "/video/projects/:projectId/timelines/:leg/checkout",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const checkout = await buildCheckout(params.data.projectId, params.data.leg);
    if (!checkout) {
      res.status(400).json({ error: "Save a snapshot before checking out" });
      return;
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${checkoutFilename(checkout.projectName, params.data.leg, checkout.version, "EDL")}"`,
    );
    res.send(checkout.edl);
  },
);

// GET /video/projects/:projectId/timelines/:leg/checkout/fcpxml — the FCPXML
// variant of the checkout (Premiere/Final Cut native interchange).
router.get(
  "/video/projects/:projectId/timelines/:leg/checkout/fcpxml",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const checkout = await buildCheckout(params.data.projectId, params.data.leg);
    if (!checkout) {
      res.status(400).json({ error: "Save a snapshot before checking out" });
      return;
    }

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${checkoutFilename(checkout.projectName, params.data.leg, checkout.version, "FCPXML")}"`,
    );
    res.send(checkout.fcpxml);
  },
);

// GET /video/projects/:projectId/timelines/:leg/checkout/otio — the OTIO
// variant of the checkout (OpenTimelineIO, the canonical interchange).
router.get(
  "/video/projects/:projectId/timelines/:leg/checkout/otio",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const checkout = await buildCheckout(params.data.projectId, params.data.leg);
    if (!checkout) {
      res.status(400).json({ error: "Save a snapshot before checking out" });
      return;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${checkoutFilename(checkout.projectName, params.data.leg, checkout.version, "OTIO")}"`,
    );
    res.send(checkout.otio);
  },
);

// GET /video/projects/:projectId/timelines/:leg/checkout/aaf — the AAF
// variant of the checkout (Advanced Authoring Format, export-only per the
// design; editors import it into Avid/Premiere via AMA).
router.get(
  "/video/projects/:projectId/timelines/:leg/checkout/aaf",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const checkout = await buildCheckout(params.data.projectId, params.data.leg);
    if (!checkout) {
      res.status(400).json({ error: "Save a snapshot before checking out" });
      return;
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${checkoutFilename(checkout.projectName, params.data.leg, checkout.version, "AAF")}"`,
    );
    res.send(checkout.aaf);
  },
);

// GET /video/projects/:projectId/timelines/:leg/checkout/manifest — the
// referenced source media (for the re-import/bundle half of the round-trip).
router.get(
  "/video/projects/:projectId/timelines/:leg/checkout/manifest",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const checkout = await buildCheckout(params.data.projectId, params.data.leg);
    if (!checkout) {
      res.status(400).json({ error: "Save a snapshot before checking out" });
      return;
    }

    res.json({
      projectId: params.data.projectId,
      leg: params.data.leg,
      version: checkout.version,
      media: checkout.manifest.map((item) => ({
        ...item,
        downloadPath: `/api/video/projects/${params.data.projectId}/files/${item.assetId}/download`,
      })),
    });
  },
);

// POST /video/projects/:projectId/timelines/:leg/checkout/export — enqueue a
// background EXPORT_BUNDLE job that materializes the leg's saved snapshot as
// a single downloadable zip (all four interchange docs + manifest, plus the
// referenced media when requested). Progress streams to the project room via
// `job.progress`, so the client shows queue state instead of a blocking call.
router.post(
  "/video/projects/:projectId/timelines/:leg/checkout/export",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const checkout = await buildCheckout(params.data.projectId, params.data.leg);
    if (!checkout) {
      res.status(400).json({ error: "Save a snapshot before checking out" });
      return;
    }

    const body = ExportVideoTimelineCheckoutBody.safeParse(req.body ?? {});
    const includeMedia = body.success ? (body.data.includeMedia ?? false) : false;

    if (await hasActiveExportBundle(params.data.projectId, params.data.leg)) {
      res.status(409).json({ error: "A bundle is already being built for this leg" });
      return;
    }

    const job = await enqueueExportBundleJob(
      params.data.projectId,
      params.data.leg,
      includeMedia,
    );
    res.status(201).json(ExportVideoTimelineCheckoutResponse.parse(job));
  },
);

// GET /video/projects/:projectId/timelines/:leg/checkout/bundle — the current
// bundle-build job for this leg (or the latest one, if no build is running).
// Lets the client poll queue state and, when SUCCEEDED, download the zip.
router.get(
  "/video/projects/:projectId/timelines/:leg/checkout/bundle",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [job] = await db
      .select()
      .from(tandemVideoJobsTable)
      .where(
        and(
          eq(tandemVideoJobsTable.projectId, params.data.projectId),
          eq(tandemVideoJobsTable.type, "EXPORT_BUNDLE"),
        ),
      )
      .orderBy(desc(tandemVideoJobsTable.createdAt))
      .limit(1);

    if (!job) {
      res.status(404).json({ error: "No bundle has been built for this leg yet" });
      return;
    }
    const legMatch = (job.params as { leg?: string } | null)?.leg === params.data.leg;
    if (!legMatch) {
      res.status(404).json({ error: "No bundle has been built for this leg yet" });
      return;
    }

    res.json(GetVideoTimelineCheckoutBundleResponse.parse(job));
  },
);

// GET /video/projects/:projectId/timelines/:leg/checkout/bundle/download —
// stream the built bundle zip (404 until an EXPORT_BUNDLE job succeeds).
router.get(
  "/video/projects/:projectId/timelines/:leg/checkout/bundle/download",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [job] = await db
      .select()
      .from(tandemVideoJobsTable)
      .where(
        and(
          eq(tandemVideoJobsTable.projectId, params.data.projectId),
          eq(tandemVideoJobsTable.type, "EXPORT_BUNDLE"),
        ),
      )
      .orderBy(desc(tandemVideoJobsTable.createdAt))
      .limit(1);

    const legMatch = (job?.params as { leg?: string } | null)?.leg === params.data.leg;
    if (!job || !legMatch || job.status !== "SUCCEEDED") {
      res.status(404).json({ error: "The bundle is not ready yet" });
      return;
    }

    const result = (job.result ?? {}) as { storageKey?: string; sizeBytes?: number };
    if (!result.storageKey) {
      res.status(404).json({ error: "The bundle file is missing" });
      return;
    }

    const filePath = path.join(uploadDir(), result.storageKey);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "The bundle file is missing from disk" });
      return;
    }

    const stat = fs.statSync(filePath);
    const version = (job.result as { version?: number | null } | null)?.version ?? 0;
    const slug = `project-${params.data.projectId.slice(0, 8)}`;
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${slug}-${params.data.leg.toLowerCase()}-v${version}.zip"`,
    );
    res.setHeader("Content-Length", stat.size);
    fs.createReadStream(filePath).pipe(res);
  },
);

// POST /video/projects/:projectId/timelines/:leg/import — the push half of the
// round-trip: parse an external interchange document (CMX3600 EDL or FCPXML),
// relink sources to vault assets, save a new timeline version, and (by
// default) submit it for Captain review.
router.post(
  "/video/projects/:projectId/timelines/:leg/import",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoTimelineParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown leg" });
      return;
    }

    const rawBody = (req.body ?? {}) as {
      format?: unknown;
      document?: unknown;
      message?: unknown;
      submit?: unknown;
    };
    const rawFormat =
      typeof rawBody.format === "string" ? rawBody.format.toUpperCase() : "EDL";
    const format: "EDL" | "FCPXML" | "OTIO" =
      rawFormat === "FCPXML" || rawFormat === "OTIO" ? rawFormat : "EDL";
    const document = typeof rawBody.document === "string" ? rawBody.document : "";
    const message = typeof rawBody.message === "string" ? rawBody.message.trim() : "";
    const submit = rawBody.submit !== false;
    if (!document.trim()) {
      res.status(400).json({ error: "No interchange document to import" });
      return;
    }

    const member = await requireLegEditor(params.data.projectId, params.data.leg, userId);
    if (!member) {
      res.status(403).json({ error: "Only the leg role (or the Captain) can import this timeline" });
      return;
    }

    const assets = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.projectId, params.data.projectId));
    const assetRefs = assets.map((asset) => ({ id: asset.id, fileName: asset.fileName }));

    let clips: EdlClip[];
    let unresolved: string[];
    let sourceLabel: string;
    if (format === "FCPXML") {
      let events: ParsedFcpxmlClip[];
      try {
        events = parseTimelineFcpxml(document);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Could not parse the FCPXML" });
        return;
      }
      if (events.length === 0) {
        res.status(400).json({ error: "The FCPXML has no edit events" });
        return;
      }
      const resolved = resolveFcpxmlEvents(events, assetRefs);
      clips = resolved.clips;
      unresolved = resolved.unresolved;
      sourceLabel = "FCPXML";
    } else if (format === "OTIO") {
      let events: ParsedOtioClip[];
      try {
        events = parseTimelineOtio(document);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Could not parse the OTIO" });
        return;
      }
      if (events.length === 0) {
        res.status(400).json({ error: "The OTIO has no edit events" });
        return;
      }
      const resolved = resolveOtioEvents(events, assetRefs);
      clips = resolved.clips;
      unresolved = resolved.unresolved;
      sourceLabel = "OTIO";
    } else {
      let events: ParsedEdlEvent[];
      try {
        events = parseTimelineEdl(document);
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Could not parse the EDL" });
        return;
      }
      if (events.length === 0) {
        res.status(400).json({ error: "The EDL has no edit events" });
        return;
      }
      const resolved = resolveEdlEvents(events, assetRefs);
      clips = resolved.clips;
      unresolved = resolved.unresolved;
      sourceLabel = "EDL";
    }
    if (unresolved.length > 0) {
      res.status(400).json({
        error: `Some ${sourceLabel} sources are not in the vault — upload them first`,
        unresolved,
      });
      return;
    }

    // Save the imported cut as a new Git-style version (same shape as a save).
    const [timeline] = await db
      .select()
      .from(tandemVideoTimelinesTable)
      .where(
        and(
          eq(tandemVideoTimelinesTable.projectId, params.data.projectId),
          eq(tandemVideoTimelinesTable.leg, params.data.leg),
        ),
      )
      .limit(1);

    let timelineId = timeline?.id ?? "";
    if (!timeline) {
      const [created] = await db
        .insert(tandemVideoTimelinesTable)
        .values({
          id: randomUUID(),
          projectId: params.data.projectId,
          leg: params.data.leg,
          status: "DRAFT",
        })
        .returning();
      timelineId = created.id;
    }

    const [latest] = await db
      .select()
      .from(tandemVideoTimelineVersionsTable)
      .where(eq(tandemVideoTimelineVersionsTable.timelineId, timelineId))
      .orderBy(desc(tandemVideoTimelineVersionsTable.version))
      .limit(1);

    const versionNumber = (latest?.version ?? 0) + 1;
    // Merge the imported clips into the current head snapshot so leg-specific
    // fields survive an external edit (music/passes on SOUND, grades/lower
    // thirds/captions on FINISH, scene blocks on SELECTS). Only `clips` is
    // replaced by the EDL.
    const snapshot = {
      ...((latest?.snapshot ?? {}) as Record<string, unknown>),
      clips,
    };
    const [version] = await db
      .insert(tandemVideoTimelineVersionsTable)
      .values({
        id: randomUUID(),
        timelineId,
        version: versionNumber,
        snapshot,
        message: message || `Imported from ${sourceLabel} (${clips.length} clips)`,
        createdById: userId,
        parentVersionId: latest?.id ?? null,
      })
      .returning();

    await db
      .update(tandemVideoTimelinesTable)
      .set({ currentVersionId: version.id, updatedAt: new Date() })
      .where(eq(tandemVideoTimelinesTable.id, timelineId));

    emitToProject(params.data.projectId, "timeline.saved", {
      projectId: params.data.projectId,
      leg: params.data.leg,
      version: version.version,
      versionId: version.id,
      message: version.message,
      createdById: userId,
    });

    // Default to submitting the imported cut for review (the round-trip push).
    let submissionId: string | null = null;
    if (submit) {
      const [pending] = await db
        .select()
        .from(tandemVideoSubmissionsTable)
        .where(
          and(
            eq(tandemVideoSubmissionsTable.projectId, params.data.projectId),
            eq(tandemVideoSubmissionsTable.leg, params.data.leg),
            eq(tandemVideoSubmissionsTable.status, "SUBMITTED"),
          ),
        )
        .limit(1);

      if (!pending) {
        const [submission] = await db
          .insert(tandemVideoSubmissionsTable)
          .values({
            id: randomUUID(),
            projectId: params.data.projectId,
            leg: params.data.leg,
            timelineVersionId: version.id,
            status: "SUBMITTED",
            note: message || "Imported from an external editor",
            submittedById: userId,
          })
          .returning();
        submissionId = submission.id;

        await db
          .update(tandemVideoTimelinesTable)
          .set({ status: "SUBMITTED", updatedAt: new Date() })
          .where(eq(tandemVideoTimelinesTable.id, timelineId));

        emitToProject(params.data.projectId, "submission.new", submission);

        const [owner] = await db
          .select()
          .from(tandemVideoProjectsTable)
          .where(eq(tandemVideoProjectsTable.id, params.data.projectId))
          .limit(1);
        if (owner && owner.ownerId !== userId) {
          await notify(
            owner.ownerId,
            "video_submission",
            `Leg ${params.data.leg} submitted for review`,
            `The ${params.data.leg} leg was submitted from an external edit${version.message ? ` — “${version.message.slice(0, 120)}”` : ""}.`,
            `/creators-den/projects/${params.data.projectId}`,
            submission.id,
          ).catch(() => {});
        }

        if (params.data.leg === "CUT") {
          await enqueueRenderJob(
            params.data.projectId,
            params.data.leg,
            "PICTURE_LOCK",
            clips[0]?.assetId ?? timelineId,
            version.id,
          ).catch(() => {});
        }
      }
    }

    res.status(201).json({
      version: version.version,
      clips: clips.length,
      submissionId,
    });
  },
);

export default router;
