import { getAuth, clerkClient } from "@clerk/express";
import { emitToProject } from "../realtime";
import {
  db,
  tandemVideoProjectsTable,
  tandemVideoMembersTable,
  tandemVideoAssetsTable,
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
import { randomUUID } from "node:crypto";
import type { TandemVideoMember } from "@workspace/db";
import { upload } from "../video/upload";
import { createAssetFromUpload } from "../video/content-address";
import { recordVideoActivity } from "../video/activity";
import { resolveUserNames } from "../lib/user-names";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// The Lock: raw footage lives server-side only. These routes record metadata;
// there is intentionally no download/stream endpoint yet (arrives with the
// proxy + processing milestone). Files land on disk today, object storage
// later — `VIDEO_UPLOAD_DIR` overrides the location (tests point it at tmp).
// ---------------------------------------------------------------------------

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

  const captainNames = await resolveUserNames([member.userId]);

  res.status(201).json(
    CreateVideoProjectResponse.parse({
      ...project,
      myRole: member.role,
      members: [{ ...member, name: captainNames[member.userId] ?? null }],
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

  // Resolve member ids to Clerk display names (cached, best-effort) so the
  // vault roster and the commit log read names instead of raw ids.
  const memberNames = await resolveUserNames(members.map((member) => member.userId));

  res.json(
    GetVideoProjectResponse.parse({
      ...project,
      myRole: member.role,
      members: members.map((row) => ({ ...row, name: memberNames[row.userId] ?? null })),
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
      const invitedNames = await resolveUserNames([clerkUserId]);
      res.status(201).json(
        AddVideoProjectMemberResponse.parse({
          ...member,
          name: invitedNames[clerkUserId] ?? null,
        }),
      );
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

    const { asset, status, deduplicated } = await createAssetFromUpload({
      projectId: params.data.projectId,
      uploaderId: userId,
      kind: rawKind,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype || "application/octet-stream",
      sizeBytes: req.file.size,
      filePath: req.file.path,
      storageKey: req.file.filename,
    });

    // Realtime: the vault shows the new locked file as it lands (and a fully
    // reused blob is preview-ready the moment it arrives).
    emitToProject(params.data.projectId, "asset.uploaded", { ...asset, status });
    if (status === "PROCESSED") {
      emitToProject(params.data.projectId, "asset.processed", {
        projectId: params.data.projectId,
        assetId: asset.id,
      });
    }

    // Activity feed: the vault entry lands on the project timeline.
    await recordVideoActivity({
      projectId: params.data.projectId,
      eventType: "asset_uploaded",
      summary: `${asset.fileName} uploaded to the vault${deduplicated ? " — already in vault, reused" : ""}`,
      actorId: userId,
      resourceId: asset.id,
    });

    res.status(201).json(UploadVideoAssetResponse.parse({ ...asset, status }));
  },
);

export default router;
