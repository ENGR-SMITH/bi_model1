import { getAuth, clerkClient } from "@clerk/express";
import { emitToProject } from "../realtime";
import {
  db,
  tandemVideoProjectsTable,
  tandemVideoMembersTable,
  tandemVideoAssetsTable,
  tandemVideoAssetFilesTable,
} from "@workspace/db";
import {
  AddVideoProjectMemberBody,
  AddVideoProjectMemberParams,
  AddVideoProjectMemberResponse,
  CreateVideoProjectBody,
  CreateVideoProjectResponse,
  GetVideoProjectParams,
  GetVideoProjectResponse,
  ListVideoAssetsParams,
  ListVideoAssetsResponse,
  ListVideoProjectsResponse,
  UploadVideoAssetParams,
  UploadVideoAssetResponse,
} from "@workspace/api-zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TandemVideoMember } from "@workspace/db";
import { enqueueAssetJobs } from "../video/worker";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// The Lock: raw footage lives server-side only. These routes record metadata;
// there is intentionally no download/stream endpoint yet (arrives with the
// proxy + processing milestone). Files land on disk today, object storage
// later — `VIDEO_UPLOAD_DIR` overrides the location (tests point it at tmp).
// ---------------------------------------------------------------------------

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), ".uploads", "video");

function uploadDir(): string {
  return process.env.VIDEO_UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
}

const ALLOWED_ASSET_KINDS = [
  "RAW_VIDEO",
  "RAW_AUDIO",
  "SCREEN_REC",
  "B_ROLL",
  "REFERENCE",
  "VO_PICKUP",
  "GRAPHIC",
  "THUMBNAIL_DESIGN",
] as const;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = uploadDir();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB cap for raw footage
});

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

// GET /video/projects — the user's projects (owned or member).
router.get("/video/projects", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const owned = await db
    .select()
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.ownerId, userId));

  const memberships = await db
    .select({ projectId: tandemVideoMembersTable.projectId })
    .from(tandemVideoMembersTable)
    .where(
      and(
        eq(tandemVideoMembersTable.userId, userId),
        eq(tandemVideoMembersTable.status, "ACTIVE"),
      ),
    );

  const memberProjectIds = memberships.map((m) => m.projectId);
  const viaMembership =
    memberProjectIds.length > 0
      ? await db
          .select()
          .from(tandemVideoProjectsTable)
          .where(inArray(tandemVideoProjectsTable.id, memberProjectIds))
      : [];

  const byId = new Map<string, (typeof owned)[number]>();
  for (const project of [...owned, ...viaMembership]) byId.set(project.id, project);
  const projects = [...byId.values()].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );

  res.json(ListVideoProjectsResponse.parse(projects));
});

// POST /video/projects — create a project; the creator becomes the Captain.
router.post("/video/projects", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const parsed = CreateVideoProjectBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid video project request");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const projectId = randomUUID();
  const memberId = randomUUID();

  const [project, member] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tandemVideoProjectsTable)
      .values({
        id: projectId,
        ownerId: userId,
        name: parsed.data.name,
        description: parsed.data.description ?? "",
      })
      .returning();
    const [captain] = await tx
      .insert(tandemVideoMembersTable)
      .values({
        id: memberId,
        projectId,
        userId,
        role: "CAPTAIN",
        status: "ACTIVE",
      })
      .returning();
    return [created, captain] as const;
  });

  res.status(201).json(
    CreateVideoProjectResponse.parse({
      ...project,
      myRole: member.role,
      members: [member],
      assets: [],
    }),
  );
});

// GET /video/projects/:projectId — detail with members + assets (members only).
router.get("/video/projects/:projectId", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const params = GetVideoProjectParams.safeParse(req.params);
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

  const member = await requireMember(project.id, userId);
  if (!member) {
    res.status(403).json({ error: "You are not a member of this project" });
    return;
  }

  const members = await db
    .select()
    .from(tandemVideoMembersTable)
    .where(
      and(
        eq(tandemVideoMembersTable.projectId, project.id),
        eq(tandemVideoMembersTable.status, "ACTIVE"),
      ),
    );

  const assets = await db
    .select()
    .from(tandemVideoAssetsTable)
    .where(eq(tandemVideoAssetsTable.projectId, project.id))
    .orderBy(desc(tandemVideoAssetsTable.createdAt));

  res.json(
    GetVideoProjectResponse.parse({
      ...project,
      myRole: member.role,
      members,
      assets,
    }),
  );
});

// POST /video/projects/:projectId/members — invite by email, Captain only.
router.post(
  "/video/projects/:projectId/members",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = AddVideoProjectMemberParams.safeParse(req.params);
    const body = AddVideoProjectMemberBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid member request" });
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
      res.status(403).json({ error: "Only the Captain can add members" });
      return;
    }

    let clerkUserId: string | null = null;
    try {
      const users = await clerkClient.users.getUserList({
        emailAddress: [body.data.email],
      });
      clerkUserId = users.data[0]?.id ?? null;
    } catch {
      clerkUserId = null;
    }
    if (!clerkUserId) {
      res
        .status(400)
        .json({ error: "No Tandem account found for that email address" });
      return;
    }

    try {
      const [member] = await db
        .insert(tandemVideoMembersTable)
        .values({
          id: randomUUID(),
          projectId: project.id,
          userId: clerkUserId,
          role: body.data.role,
          status: "ACTIVE",
        })
        .returning();
      res.status(201).json(AddVideoProjectMemberResponse.parse(member));
    } catch {
      res.status(409).json({ error: "That user is already a member" });
    }
  },
);

// GET /video/projects/:projectId/assets — the locked vault (members only).
router.get(
  "/video/projects/:projectId/assets",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoAssetsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const assets = await db
      .select()
      .from(tandemVideoAssetsTable)
      .where(eq(tandemVideoAssetsTable.projectId, params.data.projectId))
      .orderBy(desc(tandemVideoAssetsTable.createdAt));

    res.json(ListVideoAssetsResponse.parse(assets));
  },
);

// POST /video/projects/:projectId/assets — upload raw footage into the vault.
router.post(
  "/video/projects/:projectId/assets",
  upload.single("file"),
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = UploadVideoAssetParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    const member = await requireMember(params.data.projectId, userId);
    if (!member) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "A file is required" });
      return;
    }

    const rawKind = String(req.body?.kind ?? "RAW_VIDEO");
    if (!ALLOWED_ASSET_KINDS.includes(rawKind as (typeof ALLOWED_ASSET_KINDS)[number])) {
      res.status(400).json({ error: `Unknown asset kind: ${rawKind}` });
      return;
    }

    const [asset] = await db
      .insert(tandemVideoAssetsTable)
      .values({
        id: randomUUID(),
        projectId: params.data.projectId,
        uploaderId: userId,
        kind: rawKind,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype || "application/octet-stream",
        sizeBytes: req.file.size,
        durationMs: null,
        storageKey: req.file.filename,
        status: "UPLOADED",
        version: 0,
      })
      .returning();

    // A designed thumbnail is already a web-ready image — it needs no ffmpeg
    // proxy or whisper transcript. The original doubles as the preview file.
    if (rawKind === "THUMBNAIL_DESIGN") {
      await db.insert(tandemVideoAssetFilesTable).values({
        id: randomUUID(),
        assetId: asset.id,
        kind: "PROXY",
        storageKey: asset.storageKey,
        mimeType: asset.mimeType || "image/png",
        sizeBytes: asset.sizeBytes,
        metadata: { demo: false, degraded: false, original: true },
      });
      await db
        .update(tandemVideoAssetsTable)
        .set({ status: "PROCESSED" })
        .where(eq(tandemVideoAssetsTable.id, asset.id));
      emitToProject(params.data.projectId, "asset.processed", {
        projectId: params.data.projectId,
        assetId: asset.id,
      });
    } else {
      // Kick off proxy + transcription; the in-process worker picks these up.
      await enqueueAssetJobs(asset);
    }

    // Realtime: the vault shows the new locked file as it lands.
    emitToProject(params.data.projectId, "asset.uploaded", asset);

    // A designed thumbnail is preview-ready the moment it lands.
    const response =
      rawKind === "THUMBNAIL_DESIGN" ? { ...asset, status: "PROCESSED" } : asset;
    res.status(201).json(UploadVideoAssetResponse.parse(response));
  },
);

export default router;
