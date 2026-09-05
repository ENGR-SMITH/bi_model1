import { getAuth } from "@clerk/express";
import { emitJobProgress, emitToProject, emitToUser } from "../realtime";
import {
  db,
  tandemVideoAssetsTable,
  tandemVideoDownloadsTable,
  tandemVideoGrantsTable,
  tandemVideoJobsTable,
  tandemVideoMembersTable,
  tandemVideoNotificationsTable,
  tandemVideoProjectsTable,
  tandemVideoReferencesTable,
  type TandemVideoMember,
} from "@workspace/db";
import {
  AnalyzeVideoReferenceParams,
  AnalyzeVideoReferenceResponse,
  CreateVideoGrantBody,
  CreateVideoGrantParams,
  CreateVideoGrantResponse,
  GetVideoReferenceParams,
  GetVideoReferenceResponse,
  ListVideoGrantsParams,
  ListVideoGrantsResponse,
  ListVideoNotificationsResponse,
  MarkVideoNotificationReadParams,
  MarkVideoNotificationReadResponse,
  RevokeVideoGrantParams,
  RevokeVideoGrantResponse,
} from "@workspace/api-zod";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// M4 — platform features. Viral reference import (pacing analysis + side-by-
// side guide), Captain-issued temporary download grants with instant revoke,
// and the Tandem notifications center (mirrors the parent's inbox pattern).
// ---------------------------------------------------------------------------

/**
 * The /creators-den deep link for a project notification. Projects inside a
 * channel link straight to the channel-scoped page (no redirect hop); legacy
 * unlinked projects keep the flat path, which the frontend gate resolves.
 */
export function projectDeepLink(channelId: string | null, projectId: string, rest = ""): string {
  return channelId
    ? `/creators-den/channels/${channelId}/projects/${projectId}${rest}`
    : `/creators-den/projects/${projectId}${rest}`;
}

const LEG_ROLES: Record<string, string> = {
  SELECTS: "VIDEO",
  CUT: "VIDEO",
  SOUND: "AUDIO",
  FINISH: "CAPTAIN",
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

async function isCaptain(projectId: string, userId: string): Promise<boolean> {
  const [project] = await db
    .select()
    .from(tandemVideoProjectsTable)
    .where(eq(tandemVideoProjectsTable.id, projectId))
    .limit(1);
  return project?.ownerId === userId;
}

/** Writes a Tandem notification and streams it to the recipient's room. */
async function notify(
  recipientId: string,
  category: string,
  title: string,
  body: string,
  deepLink: string,
  resourceId?: string,
): Promise<void> {
  const [notification] = await db
    .insert(tandemVideoNotificationsTable)
    .values({
      id: randomUUID(),
      recipientId,
      category,
      title,
      body,
      deepLink,
      resourceId: resourceId ?? null,
    })
    .returning();
  // `source` tells clients which den wrote the notice so a toast/inbox row
  // can label it correctly (the collaboration feed carries "authors").
  emitToUser(recipientId, "notification.new", { ...notification, source: "creators" });
}

// POST /video/projects/:projectId/assets/:assetId/reference-analyze — queue
// pacing analysis of a REFERENCE asset (Architect's side-by-side guide).
router.post(
  "/video/projects/:projectId/assets/:assetId/reference-analyze",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = AnalyzeVideoReferenceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid asset id" });
      return;
    }

    const member = await requireMember(params.data.projectId, userId);
    if (!member || (!(member.roles ?? []).includes("CAPTAIN") && !(member.roles ?? []).includes(LEG_ROLES.SELECTS))) {
      res.status(403).json({ error: "Only the Video editor (or the Captain) can analyze a reference" });
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

    const [job] = await db
      .insert(tandemVideoJobsTable)
      .values({
        id: randomUUID(),
        projectId: params.data.projectId,
        assetId: asset.id,
        type: "REFERENCE_ANALYZE",
        params: {},
      })
      .returning();
    emitJobProgress({ projectId: job.projectId, jobId: job.id, type: job.type, status: "QUEUED" });

    res.status(201).json(AnalyzeVideoReferenceResponse.parse(job));
  },
);

// GET /video/projects/:projectId/assets/:assetId/reference — the pacing.
router.get(
  "/video/projects/:projectId/assets/:assetId/reference",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = GetVideoReferenceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid asset id" });
      return;
    }

    if (!(await requireMember(params.data.projectId, userId))) {
      res.status(403).json({ error: "You are not a member of this project" });
      return;
    }

    const [reference] = await db
      .select()
      .from(tandemVideoReferencesTable)
      .where(eq(tandemVideoReferencesTable.assetId, params.data.assetId))
      .limit(1);
    if (!reference) {
      res.status(404).json({ error: "No pacing analysis yet — run the reference analysis first" });
      return;
    }

    res.json(GetVideoReferenceResponse.parse(reference));
  },
);

// GET /video/projects/:projectId/grants — temporary download grants (Captain).
router.get(
  "/video/projects/:projectId/grants",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = ListVideoGrantsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }

    if (!(await isCaptain(params.data.projectId, userId))) {
      res.status(403).json({ error: "Only the Captain can view download grants" });
      return;
    }

    const grants = await db
      .select()
      .from(tandemVideoGrantsTable)
      .where(eq(tandemVideoGrantsTable.projectId, params.data.projectId))
      .orderBy(desc(tandemVideoGrantsTable.createdAt));

    res.json(
      ListVideoGrantsResponse.parse(
        grants.map((grant) => ({ ...grant, roles: grant.roles ?? [] })),
      ),
    );
  },
);

// POST /video/projects/:projectId/grants — grant a member a temporary download.
router.post(
  "/video/projects/:projectId/grants",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = CreateVideoGrantParams.safeParse(req.params);
    const body = CreateVideoGrantBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid grant request" });
      return;
    }

    if (!(await isCaptain(params.data.projectId, userId))) {
      res.status(403).json({ error: "Only the Captain can grant downloads" });
      return;
    }

    // The member must belong to the project.
    const member = await requireMember(params.data.projectId, body.data.memberId);
    if (!member) {
      res.status(400).json({ error: "That user is not a member of this project" });
      return;
    }

    // Grants are role-scoped: at least one role, or ["ALL"] for every file.
    const roles = [...new Set(body.data.roles)];
    if (roles.length === 0) {
      res.status(400).json({ error: "Pick at least one role to grant" });
      return;
    }
    if (roles.includes("ALL") && roles.length > 1) {
      roles.splice(0, roles.length, "ALL");
    }

    const hours = Math.min(168, Math.max(1, body.data.expiresInHours ?? 24));
    const [grant] = await db
      .insert(tandemVideoGrantsTable)
      .values({
        id: randomUUID(),
        projectId: params.data.projectId,
        roles,
        memberId: body.data.memberId,
        reason: body.data.reason ?? "",
        grantedById: userId,
        expiresAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      })
      .returning();
    emitToProject(params.data.projectId, "grant.created", grant);

    const [grantProject] = await db
      .select({ channelId: tandemVideoProjectsTable.channelId })
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.id, params.data.projectId))
      .limit(1);
    await notify(
      body.data.memberId,
      "video_grant",
      "Download access granted",
      `The Captain granted you temporary download access${body.data.reason ? ` — ${body.data.reason}` : ""}.`,
      projectDeepLink(grantProject?.channelId ?? null, params.data.projectId),
      grant.id,
    );

    res.status(201).json(CreateVideoGrantResponse.parse(grant));
  },
);

// POST /video/projects/:projectId/grants/:grantId/revoke — instant revoke.
router.post(
  "/video/projects/:projectId/grants/:grantId/revoke",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = RevokeVideoGrantParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid grant id" });
      return;
    }

    if (!(await isCaptain(params.data.projectId, userId))) {
      res.status(403).json({ error: "Only the Captain can revoke grants" });
      return;
    }

    const [grant] = await db
      .select()
      .from(tandemVideoGrantsTable)
      .where(
        and(
          eq(tandemVideoGrantsTable.id, params.data.grantId),
          eq(tandemVideoGrantsTable.projectId, params.data.projectId),
        ),
      )
      .limit(1);
    if (!grant) {
      res.status(404).json({ error: "Grant not found" });
      return;
    }
    if (grant.revokedAt) {
      res.status(409).json({ error: "This grant is already revoked" });
      return;
    }

    const [revoked] = await db
      .update(tandemVideoGrantsTable)
      .set({ revokedAt: new Date() })
      .where(eq(tandemVideoGrantsTable.id, grant.id))
      .returning();
    emitToProject(params.data.projectId, "grant.revoked", revoked);

    const [revokeProject] = await db
      .select({ channelId: tandemVideoProjectsTable.channelId })
      .from(tandemVideoProjectsTable)
      .where(eq(tandemVideoProjectsTable.id, params.data.projectId))
      .limit(1);
    await notify(
      grant.memberId,
      "video_grant_revoked",
      "Download access revoked",
      "The Captain revoked your temporary download access.",
      projectDeepLink(revokeProject?.channelId ?? null, params.data.projectId),
      grant.id,
    );

    res.json(RevokeVideoGrantResponse.parse(revoked));
  },
);

// GET /video/notifications — the signed-in user's Tandem notifications.
router.get("/video/notifications", async (req: Request, res: Response): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const notifications = await db
    .select()
    .from(tandemVideoNotificationsTable)
    .where(eq(tandemVideoNotificationsTable.recipientId, userId))
    .orderBy(desc(tandemVideoNotificationsTable.createdAt))
    .limit(50);

  res.json(ListVideoNotificationsResponse.parse(notifications));
});

// POST /video/notifications/:notificationId/read — mark read.
router.post(
  "/video/notifications/:notificationId/read",
  async (req: Request, res: Response): Promise<void> => {
    const userId = getAuth(req).userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const params = MarkVideoNotificationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid notification id" });
      return;
    }

    const [notification] = await db
      .select()
      .from(tandemVideoNotificationsTable)
      .where(eq(tandemVideoNotificationsTable.id, params.data.notificationId))
      .limit(1);
    if (!notification || notification.recipientId !== userId) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    const [updated] = await db
      .update(tandemVideoNotificationsTable)
      .set({ readAt: notification.readAt ?? new Date() })
      .where(eq(tandemVideoNotificationsTable.id, notification.id))
      .returning();

    res.json(MarkVideoNotificationReadResponse.parse(updated));
  },
);

export { router, notify, requireMember };
export default router;
