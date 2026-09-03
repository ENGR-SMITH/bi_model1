import fs from "node:fs";
import { getAuth, clerkClient } from "@clerk/express";
import { emitToProject } from "../realtime";
import {
  db,
  tandemVideoProjectsTable,
  tandemVideoMembersTable,
  tandemVideoAssetsTable,
  tandemVideoAssetFilesTable,
  tandemVideoTranscriptsTable,
  tandemVideoTranscriptSegmentsTable,
  tandemVideoReferencesTable,
  tandemVideoGrantsTable,
  tandemVideoDownloadsTable,
  tandemVideoCommentsTable,
  tandemVideoSubmissionsTable,
  tandemVideoTimelinesTable,
  tandemVideoTimelineVersionsTable,
  tandemVideoJobsTable,
  tandemVideoSyncsTable,
  collaborationActivityEventsTable,
} from "@workspace/db";
import {
  AddVideoProjectMemberBody,
  AddVideoProjectMemberParams,
  AddVideoProjectMemberResponse,
  RemoveVideoProjectMemberParams,
  UpdateVideoProjectMemberRolesBody,
  UpdateVideoProjectMemberRolesParams,
  UpdateVideoProjectMemberRolesResponse,
  CreateVideoProjectBody,
  CreateVideoProjectResponse,
  DeleteVideoProjectParams,
  GetVideoProjectParams,
  GetVideoProjectResponse,
  ListPublicVideoProjectsParams,
  ListPublicVideoProjectsResponse,
  ListVideoAssetsParams,
  ListVideoAssetsResponse,
  ListVideoProjectsResponse,
  UpdateVideoProjectVisibilityBody,
  UpdateVideoProjectVisibilityParams,
  UpdateVideoProjectVisibilityResponse,
  UploadVideoAssetParams,
  UploadVideoAssetResponse,
} from "@workspace/api-zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import { randomUUID } from "node:crypto";
import type { TandemVideoMember } from "@workspace/db";
import { notify } from "./video-platform";
import { upload } from "../video/upload";
import { createAssetFromUpload } from "../video/content-address";
import { ensureUploadFits } from "../video/quota";
import { captureVaultStorage, reclaimDeletedVaultFiles } from "../video/storage-cleanup";
import { recordVideoActivity } from "../video/activity";
import { resolveProjectAccess } from "../video/access";
import { resolveUserNames, resolveUserProfiles } from "../lib/user-names";
import { normalizeTandemUid, tandemUid } from "../lib/tandem-uid";

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

// A vault asset's kind feeds the same relay leg the timeline uses, so activity
// events for uploads carry the leg (SELECTS/CUT/SOUND/FINISH/THUMBNAIL) and the
// ledger can deep-link them to the right preview page (mirrors the frontend's
// ASSET_LEG map in version-timeline.tsx).
const ASSET_LEG: Record<string, string> = {
  RAW_VIDEO: "SELECTS",
  SCREEN_REC: "SELECTS",
  REFERENCE: "SELECTS",
  B_ROLL: "CUT",
  RAW_AUDIO: "SOUND",
  VO_PICKUP: "SOUND",
  GRAPHIC: "FINISH",
  THUMBNAIL_DESIGN: "THUMBNAIL",
};

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
        roles: ["CAPTAIN"],
        status: "ACTIVE",
      })
      .returning();
    return [created, captain] as const;
  });

  const captainProfiles = await resolveUserProfiles([member.userId]);

  res.status(201).json(
    CreateVideoProjectResponse.parse({
      ...project,
      myRoles: member.roles ?? [],
      members: [
        {
          ...member,
          roles: member.roles ?? [],
          name: captainProfiles[member.userId]?.name ?? null,
          imageUrl: captainProfiles[member.userId]?.imageUrl ?? null,
        },
      ],
      assets: [],
    }),
  );
});

// GET /video/projects/:projectId — detail with members + assets. Members get
// their full roles (`myRoles`); a non-member may open a PUBLIC project in
// read-only mode (`myRoles: []`) so search results can be previewed.
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

  const access = await resolveProjectAccess(project.id, userId);
  if (!access) {
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

  // Resolve member ids to Clerk display names + avatar urls (cached,
  // best-effort) so the vault roster, the commit log, and the timeline cards
  // read names (and show avatars) instead of raw ids.
  const memberProfiles = await resolveUserProfiles(members.map((member) => member.userId));

  res.json(
    GetVideoProjectResponse.parse({
      ...project,
      myRoles: access.kind === "member" ? (access.member.roles ?? []) : [],
      members: members.map((row) => ({
        ...row,
        roles: row.roles ?? [],
        name: memberProfiles[row.userId]?.name ?? null,
        imageUrl: memberProfiles[row.userId]?.imageUrl ?? null,
      })),
      assets,
    }),
  );
});

// PATCH /video/projects/:projectId/visibility — set profile visibility (Captain only).
router.patch(
  "/video/projects/:projectId/visibility",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = UpdateVideoProjectVisibilityParams.safeParse(req.params);
    const body = UpdateVideoProjectVisibilityBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid visibility request" });
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
      res.status(403).json({ error: "Only the Captain can change visibility" });
      return;
    }

    const [updated] = await db
      .update(tandemVideoProjectsTable)
      .set({
        visibility: body.data.visibility,
        updatedAt: new Date(),
      })
      .where(eq(tandemVideoProjectsTable.id, project.id))
      .returning();

    res.json(UpdateVideoProjectVisibilityResponse.parse(updated));
  },
);

// DELETE /video/projects/:projectId — remove the project and everything in it
// (Captain only), then reclaim its physical storage. Local originals are
// content-addressed and may be shared with another project, so a blob is only
// unlinked when nothing left behind references it; R2 objects are wiped by
// project prefix.
router.delete(
  "/video/projects/:projectId",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = DeleteVideoProjectParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    const projectId = params.data.projectId;
    const [project] = await db
      .select()
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.id, projectId))
      .limit(1);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (project.ownerId !== userId) {
      res.status(403).json({ error: "Only the Captain can delete the project" });
      return;
    }

    // Capture the physical keys BEFORE the rows that name them are deleted,
    // so the survivor checks can tell shared blobs apart from orphans.
    const storage = await captureVaultStorage(projectId);

    await db.transaction(async (tx) => {
      const assets = await tx
        .select({ id: tandemVideoAssetsTable.id })
        .from(tandemVideoAssetsTable)
        .where(eq(tandemVideoAssetsTable.projectId, projectId));
      const assetIds = assets.map((a) => a.id);

      const timelines = await tx
        .select({ id: tandemVideoTimelinesTable.id })
        .from(tandemVideoTimelinesTable)
        .where(eq(tandemVideoTimelinesTable.projectId, projectId));
      const timelineIds = timelines.map((t) => t.id);

      const transcripts =
        assetIds.length > 0
          ? await tx
              .select({ id: tandemVideoTranscriptsTable.id })
              .from(tandemVideoTranscriptsTable)
              .where(inArray(tandemVideoTranscriptsTable.assetId, assetIds))
          : [];
      const transcriptIds = transcripts.map((t) => t.id);

      // Asset-scoped rows (children first).
      if (assetIds.length > 0) {
        await tx
          .delete(tandemVideoAssetFilesTable)
          .where(inArray(tandemVideoAssetFilesTable.assetId, assetIds));
        await tx
          .delete(tandemVideoReferencesTable)
          .where(inArray(tandemVideoReferencesTable.assetId, assetIds));
      }
      if (transcriptIds.length > 0) {
        await tx
          .delete(tandemVideoTranscriptSegmentsTable)
          .where(inArray(tandemVideoTranscriptSegmentsTable.transcriptId, transcriptIds));
      }
      if (assetIds.length > 0) {
        await tx
          .delete(tandemVideoTranscriptsTable)
          .where(inArray(tandemVideoTranscriptsTable.assetId, assetIds));
        await tx
          .delete(tandemVideoAssetsTable)
          .where(inArray(tandemVideoAssetsTable.id, assetIds));
      }

      // Timeline-scoped rows.
      if (timelineIds.length > 0) {
        await tx
          .delete(tandemVideoTimelineVersionsTable)
          .where(inArray(tandemVideoTimelineVersionsTable.timelineId, timelineIds));
        await tx
          .delete(tandemVideoTimelinesTable)
          .where(inArray(tandemVideoTimelinesTable.id, timelineIds));
      }

      // Project-scoped rows.
      await tx
        .delete(tandemVideoSubmissionsTable)
        .where(eq(tandemVideoSubmissionsTable.projectId, projectId));
      await tx
        .delete(tandemVideoCommentsTable)
        .where(eq(tandemVideoCommentsTable.projectId, projectId));
      await tx
        .delete(tandemVideoJobsTable)
        .where(eq(tandemVideoJobsTable.projectId, projectId));
      await tx
        .delete(tandemVideoSyncsTable)
        .where(eq(tandemVideoSyncsTable.projectId, projectId));
      await tx
        .delete(tandemVideoDownloadsTable)
        .where(eq(tandemVideoDownloadsTable.projectId, projectId));
      await tx
        .delete(tandemVideoGrantsTable)
        .where(eq(tandemVideoGrantsTable.projectId, projectId));
      await tx
        .delete(collaborationActivityEventsTable)
        .where(eq(collaborationActivityEventsTable.projectId, projectId));
      await tx
        .delete(tandemVideoMembersTable)
        .where(eq(tandemVideoMembersTable.projectId, projectId));
      await tx
        .delete(tandemVideoProjectsTable)
        .where(eq(tandemVideoProjectsTable.id, projectId));
    });

    // Physical reclaim (R2 prefix + orphaned local blobs). Best-effort and
    // run after the DB delete so the survivor checks see the final state.
    await reclaimDeletedVaultFiles({
      projectId,
      keys: storage.keys,
      assetIds: storage.assetIds,
      fileIds: storage.fileIds,
      fileR2Keys: storage.fileR2Keys,
      wholeProject: true,
    });

    res.status(204).end();
  },
);

// GET /video/users/:userId/projects — public track history (PUBLIC projects only).
router.get(
  "/video/users/:userId/projects",
  async (req: Request, res): Promise<void> => {
    const viewerId = getAuth(req).userId;
    if (!viewerId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListPublicVideoProjectsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid user id" });
      return;
    }

    const profileUserId = params.data.userId;

    const owned = await db
      .select()
      .from(tandemVideoProjectsTable)
      .where(
        and(
          eq(tandemVideoProjectsTable.ownerId, profileUserId),
          eq(tandemVideoProjectsTable.visibility, "PUBLIC"),
        ),
      );

    const memberships = await db
      .select({ projectId: tandemVideoMembersTable.projectId })
      .from(tandemVideoMembersTable)
      .where(
        and(
          eq(tandemVideoMembersTable.userId, profileUserId),
          eq(tandemVideoMembersTable.status, "ACTIVE"),
        ),
      );

    const memberProjectIds = memberships.map((m) => m.projectId);
    const viaMembership =
      memberProjectIds.length > 0
        ? await db
            .select()
            .from(tandemVideoProjectsTable)
            .where(
              and(
                inArray(tandemVideoProjectsTable.id, memberProjectIds),
                eq(tandemVideoProjectsTable.visibility, "PUBLIC"),
              ),
            )
        : [];

    const byId = new Map<string, (typeof owned)[number]>();
    for (const project of [...owned, ...viaMembership]) byId.set(project.id, project);
    const projects = [...byId.values()].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );

    res.json(ListPublicVideoProjectsResponse.parse(projects));
  },
);

// POST /video/projects/:projectId/members — invite by unique Tandem ID
// (e.g. TANDEM6EUHY), Captain only. The ID is derived from the user's Clerk
// id, so it is resolved here by walking the Clerk user list and matching
// computed IDs.
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

    const targetUid = normalizeTandemUid(body.data.uid);
    let clerkUserId: string | null = null;
    try {
      // The derived ID is not searchable in Clerk, so walk the user list in
      // pages and compare computed IDs (safe cap for a small team product).
      const PAGE = 100;
      const MAX_SCAN = 2000;
      let offset = 0;
      while (offset < MAX_SCAN) {
        const users = await clerkClient.users.getUserList({ limit: PAGE, offset });
        if (users.data.length === 0) break;
        const hit = users.data.find((user) => tandemUid(user.id) === targetUid);
        if (hit) {
          clerkUserId = hit.id;
          break;
        }
        offset += users.data.length;
      }
    } catch {
      clerkUserId = null;
    }
    if (!clerkUserId) {
      res
        .status(400)
        .json({ error: "No Tandem account found with that ID — ask them to check the ID on their profile" });
      return;
    }

    // Inviting someone who is already a member adds the new role to their
    // existing set — the Captain can hand out more roles without a separate
    // edit step.
    const existing = await requireMember(project.id, clerkUserId);
    if (existing) {
      const existingRoles = existing.roles ?? [];
      const merged = existingRoles.includes(body.data.role)
        ? existingRoles
        : [...existingRoles, body.data.role];
      const [updated] = await db
        .update(tandemVideoMembersTable)
        .set({ roles: merged })
        .where(eq(tandemVideoMembersTable.id, existing.id))
        .returning();
      const updatedProfiles = await resolveUserProfiles([clerkUserId]);
      await notify(
        clerkUserId,
        "video_invite",
        "You were added to a project",
        `The Captain added you to “${project.name}” as ${body.data.role.replaceAll("_", " ").toLowerCase()}.`,
        `/creators-den/projects/${project.id}`,
        project.id,
      ).catch(() => {});
      res.status(200).json(
        AddVideoProjectMemberResponse.parse({
          ...updated,
          name: updatedProfiles[clerkUserId]?.name ?? null,
          imageUrl: updatedProfiles[clerkUserId]?.imageUrl ?? null,
        }),
      );
      return;
    }

    try {
      const [member] = await db
        .insert(tandemVideoMembersTable)
        .values({
          id: randomUUID(),
          projectId: project.id,
          userId: clerkUserId,
          roles: [body.data.role],
          status: "ACTIVE",
        })
        .returning();
      const invitedProfiles = await resolveUserProfiles([clerkUserId]);
      await notify(
        clerkUserId,
        "video_invite",
        "You were added to a project",
        `The Captain added you to “${project.name}” as ${body.data.role.replaceAll("_", " ").toLowerCase()}.`,
        `/creators-den/projects/${project.id}`,
        project.id,
      ).catch(() => {});
      res.status(201).json(
        AddVideoProjectMemberResponse.parse({
          ...member,
          name: invitedProfiles[clerkUserId]?.name ?? null,
          imageUrl: invitedProfiles[clerkUserId]?.imageUrl ?? null,
        }),
      );
    } catch {
      res.status(409).json({ error: "That user is already a member" });
    }
  },
);

// PATCH /video/projects/:projectId/members/:memberId — replace a member's
// roles (Captain only). Grants more roles or takes them away in one call.
router.patch(
  "/video/projects/:projectId/members/:memberId",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = UpdateVideoProjectMemberRolesParams.safeParse(req.params);
    const body = UpdateVideoProjectMemberRolesBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid member roles request" });
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
      res.status(403).json({ error: "Only the Captain can change member roles" });
      return;
    }

    const [member] = await db
      .select()
      .from(tandemVideoMembersTable)
      .where(
        and(
          eq(tandemVideoMembersTable.id, params.data.memberId),
          eq(tandemVideoMembersTable.projectId, params.data.projectId),
        ),
      )
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if ((member.roles ?? []).includes("CAPTAIN")) {
      res.status(403).json({ error: "The Captain's roles cannot be changed" });
      return;
    }

    const roles = [...new Set(body.data.roles)];
    if (roles.includes("CAPTAIN")) {
      res.status(400).json({ error: "CAPTAIN cannot be assigned to another member" });
      return;
    }

    const [updated] = await db
      .update(tandemVideoMembersTable)
      .set({ roles })
      .where(eq(tandemVideoMembersTable.id, member.id))
      .returning();
    const updatedProfiles = await resolveUserProfiles([member.userId]);

    res.json(
      UpdateVideoProjectMemberRolesResponse.parse({
        ...updated,
        name: updatedProfiles[member.userId]?.name ?? null,
        imageUrl: updatedProfiles[member.userId]?.imageUrl ?? null,
      }),
    );
  },
);

// DELETE /video/projects/:projectId/members/:memberId — remove a member and
// their active grants (Captain only).
router.delete(
  "/video/projects/:projectId/members/:memberId",
  async (req: Request, res): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = RemoveVideoProjectMemberParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid member id" });
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
      res.status(403).json({ error: "Only the Captain can remove members" });
      return;
    }

    const [member] = await db
      .select()
      .from(tandemVideoMembersTable)
      .where(
        and(
          eq(tandemVideoMembersTable.id, params.data.memberId),
          eq(tandemVideoMembersTable.projectId, params.data.projectId),
        ),
      )
      .limit(1);
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    if ((member.roles ?? []).includes("CAPTAIN")) {
      res.status(403).json({ error: "The Captain cannot be removed" });
      return;
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(tandemVideoGrantsTable)
        .where(
          and(
            eq(tandemVideoGrantsTable.projectId, params.data.projectId),
            eq(tandemVideoGrantsTable.memberId, member.userId),
          ),
        );
      await tx
        .delete(tandemVideoMembersTable)
        .where(eq(tandemVideoMembersTable.id, member.id));
    });

    res.status(204).end();
  },
);

// GET /video/projects/:projectId/assets — the locked vault. Members only,
// except that a PUBLIC project is readable (read-only) by non-members so the
// preview and timeline pages can render its media.
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

    if (!(await resolveProjectAccess(params.data.projectId, userId))) {
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

    // Account quota: the owning Captain's storage must fit this upload, or the
    // file is rejected (the profile's storage bar enforces the same limit).
    const fit = await ensureUploadFits(params.data.projectId, req.file.size);
    if (!fit.ok) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // Multer file already cleaned up — nothing to do.
      }
      res.status(413).json({ error: fit.error });
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
      leg: ASSET_LEG[rawKind] ?? null,
      summary: `${asset.fileName} uploaded to the vault${deduplicated ? " — already in vault, reused" : ""}`,
      actorId: userId,
      resourceId: asset.id,
    });

    res.status(201).json(UploadVideoAssetResponse.parse({ ...asset, status }));
  },
);

export default router;
